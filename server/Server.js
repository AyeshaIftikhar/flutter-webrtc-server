import express from 'express';
var app = express();
import fs from 'fs';
import ws from 'ws';
import http from 'http';
import https from 'https';

export default class CallHandler {

    constructor() {
        this.wss = null;
        this.ws = null;
        this.clients = new Set();
        this.server = null;
        this.ssl_server = null;
        this.sessions = [];
    }

    init() {

        var ws_server_port = (process.env.PORT || 4442);
        this.server = http.createServer(app).listen(ws_server_port, () => {
            console.log("Start WS Server: bind => ws://0.0.0.0:"+ws_server_port);
        });

        this.ws = new ws.Server({ server: this.server });
        this.ws.on('connection', this.onConnection);


        var options = {
            key: fs.readFileSync('certs/key.pem'),
            cert: fs.readFileSync('certs/cert.pem')
        };

        var wss_server_port = (process.env.PORT + 1 || 4443);
        this.ssl_server = https.createServer(options, app).listen(wss_server_port, () => {
            console.log("Start WSS Server: bind => wss://0.0.0.0:"+wss_server_port);
        });

        this.wss = new ws.Server({ server: this.ssl_server });
        this.wss.on('connection', this.onConnection);
    }

    updatePeers = () => {
        var peers = [];

        this.clients.forEach(function (client) {
            var peer = {};
            if (client.hasOwnProperty('id')) {
                peer.id = client.id;
            }
            if (client.hasOwnProperty('name')) {
                peer.name = client.name;
            }
            if (client.hasOwnProperty('user_agent')) {
                peer.user_agent = client.user_agent;
            }
            if (client.hasOwnProperty('session_id')) {
                peer.session_id = client.session_id;
            }
            peers.push(peer);
        });

        var msg = {
            type: "peers",
            data: peers,
        };

        this.clients.forEach(function (client) {
            client.send(JSON.stringify(msg));
        });
    }

    onClose = (client_self, data) => {
        console.log('close');
        var session_id = client_self.session_id;
        //remove old session_id
        if (session_id !== undefined) {
            for (let i = 0; i < this.sessions.length; i++) {
                let item = this.sessions[i];
                if (item.id == session_id) {
                    this.sessions.splice(i, 1);
                    break;
                }
            }
        }
        var msg = {
            type: "leave",
            data: client_self.id,
        };

        this.clients.forEach(function (client) {
            if (client != client_self)
                client.send(JSON.stringify(msg));
        });

        this.updatePeers();
    }

    onConnection = (client_self, socket) => {
        console.log('connection');
        this.clients.add(client_self);

        client_self.on("close", (data) => {
            this.clients.delete(client_self);
            this.onClose(client_self, data)
        });

        client_self.on("message", message => {
            try {
                message = JSON.parse(message);
                console.log("message.type:: " + message.type + ", \nbody: " + JSON.stringify(message));
            } catch (e) {
                console.log(e.message);
            }

            switch (message.type) {
                case 'new':
                    {
                        client_self.id = "" + message.id;
                        client_self.name = message.name;
                        client_self.user_agent = message.user_agent;
                        this.updatePeers();
                    }
                    break;
                case 'bye':
                    {
                        var session = null;
                        this.sessions.forEach((sess) => {
                            if (sess.id == message.session_id) {
                                session = sess;
                            }
                        });

                        if (!session) {
                            var msg = {
                                type: "error",
                                data: {
                                    error: "Invalid session " + message.session_id,
                                },
                            };
                            client_self.send(JSON.stringify(msg));
                            return;
                        }

                        this.clients.forEach((client) => {
                            if (client.session_id === message.session_id) {
                                try {

                                    var msg = {
                                        type: "bye",
                                        data: {
                                            session_id: message.session_id,
                                            from: message.from,
                                            to: (client.id == session.from ? session.to : session.from),
                                        },
                                    };
                                    client.send(JSON.stringify(msg));
                                } catch (e) {
                                    console.log("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case "invite":
                    {
                        var peer = null;
                        this.clients.forEach(function (client) {
                            if (client.hasOwnProperty('id') && client.id === "" + message.to) {
                                peer = client;
                            }
                        });

                        if (peer != null) {
                            var msg = {
                                type: "ringing",
                                data: {
                                    id: peer.id,
                                    media: message.media,
                                }
                            };
                            client_self.send(JSON.stringify(msg));
                            client_self.session_id = message.session_id;

                            msg = {
                                type: "invite",
                                data: {
                                    to: peer.id,
                                    from: client_self.id,
                                    media: message.media,
                                    session_id: message.session_id,
                                }
                            }
                            peer.send(JSON.stringify(msg));
                            peer.session_id = message.session_id;

                            let session = {
                                id: message.session_id,
                                from: client_self.id,
                                to: peer.id,
                            };
                            this.sessions.push(session);
                        }

                        break;
                    }
                case 'offer':
                    {
                        var msg = {
                            type: "offer",
                            data: {
                                from: client_self.id,
                                to: message.to,
                                description: message.description,
                            },
                        };

                        this.clients.forEach(function (client) {
                            if (client.id === "" + message.to && client.session_id === message.session_id) {
                                try {
                                    client.send(JSON.stringify(msg));
                                } catch (e) {
                                    console.log("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case 'answer':
                    {
                        var msg = {
                            type: "answer",
                            data: {
                                from: client_self.id,
                                to: message.to,
                                description: message.description,
                            }
                        };

                        this.clients.forEach(function (client) {
                            if (client.id === "" + message.to && client.session_id === message.session_id) {
                                try {
                                    client.send(JSON.stringify(msg));
                                } catch (e) {
                                    console.log("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case 'candidate':
                    {
                        var msg = {
                            type: "candidate",
                            data: {
                                from: client_self.id,
                                to: message.to,
                                candidate: message.candidate,
                            }
                        };
                        
                        this.clients.forEach(function (client) {
                            if (client.id === "" + message.to && client.session_id === message.session_id) {
                                try {
                                    client.send(JSON.stringify(msg));
                                } catch (e) {
                                    console.log("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case 'keepalive':
                    client_self.send(JSON.stringify({type:'keepalive', data:{}}));
                break;
                default:
                    console.log("Unhandled message: " + message.type);
            }
        });
    }
}

let callHandler = new CallHandler();
callHandler.init();