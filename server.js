#!/usr/bin/node

"use strict"

const PORT = 5000;
const WORD_NUMBER = 40;
const DELAY = 2; // given delay for client reaction
const EXPLANATION_LENGTH = 20; // length of explanation
const PRE = 3; // delay for transfer
const POST = 3; // time for guess

const express = require("express");
const app = express();
const server = new (require("http").Server)(app);
const io = require("socket.io")(server);

server.listen(PORT);
console.log("Listening on port " + PORT);

// Serving static css and js files
app.use(express.static("css"));
app.use(express.static("js"));

// Serving page of the game by default address
app.get("/", function(req, res) {
    res.sendFile(__dirname + "/index.html");
});

//----------------------------------------------------------
// Handy functions

/**
 * Return playerList structure,
 * @see API.md
 *
 * @param room room object
 * @return list of players
 */
function getPlayerList(room) {
    return room.users.map(el => {return {"username": el.username, "online": el.online};});
}

/**
 * Finds first position in users array where element has attribute with given value
 *
 * @param users users array
 * @param field attribute
 * @param val value
 * @return position if exists else -1
 */
function findFirstPos(users, field, val) {
    for (let i = 0; i < users.length; ++i) {
        if (users[i][field] === val) {
            return i;
        }
    }
    return -1;
}

/**
 * Finds first position in users array where given socket id is in list of socket ids
 *
 * @param users users array
 * @param sid socket id
 * @return position if exists else -1
 */
function findFirstSidPos(users, sid) {
    for (let i = 0; i < users.length; ++i) {
        if (users[i]["sids"][0] === sid) {
            return i;
        }
    }
    return -1;
}

/**
 * Return current player's room.
 *
 * @param socket The socket of the player
 * @return id of current player's room: his own socket room or game room with him
 */
function getRoom(socket) {
    const sid = socket.id;
    const roomsList = Object.keys(socket.rooms);
    // Searching for the game room with the user
    for (let i = 0; i < roomsList.length; ++i) {
        if (roomsList[i] !== sid) {
            return roomsList[i]; // It's found and  returning
        }
    }
    return socket.id; // Nothing found. User's own room is returning
}

/**
 * Generate word list by key
 *
 * @param key key of the room
 * @return list of words
 */
function generateWords(key) {
    /*
    Temporary measures.
    TODO: proper word generation
    */
    let words = [];
    for (let i = 0; i < WORD_NUMBER; ++i) {
        words.push(i);
    }
    return words;
}

/**
 * get next pair of players
 * @param numberOfPlayers number of players
 * @param lastSpeaker index of previous speaker
 * @param lastListener index of precious listener
 * @return object with fields: speaker and listener --- indices of speaker and listener
 */
function getNextPair(numberOfPlayers, lastSpeaker, lastListener) {
    let speaker = (lastSpeaker + 1) % numberOfPlayers;
    let listener = (lastListener + 1) % numberOfPlayers;
    if (speaker === 0) {
        listener = (listener + 1) % numberOfPlayers;
        if (listener === speaker) {
            listener++;
        }
    }
    return {"speaker": speaker, "listener": listener};
}

/**
 * start an explanation
 *
 * @param key --- key of the room
 * @return null
 */
function startExplanation(key) {
    rooms[key].substate = "explanation";
    const date = new Date();
    const currentTime = date.getTime();
    rooms[key].startTime = currentTime + PRE * 1000;
    rooms[key].word = rooms[key].freshWords.pop();
    const numberOfTurn = rooms[key].numberOfTurn;
    setTimeout(function() {
        // if explanation hasn't finished yet
        if (!( key in rooms)) {
            return;
        }
        if (rooms[key].numberOfTurn === numberOfTurn) {
            finishExplanation(key);
        }
    }, (PRE + EXPLANATION_LENGTH + POST + DELAY) * 1000);
    setTimeout(function() {
        io.sockets.to(rooms[key].users[rooms[key].speaker].sids[0]).emit(
            "sNewWord", {"word": rooms[key].word});
    }, PRE * 1000);
    io.sockets.to(key).emit("sExplanationStarted", {"startTime": rooms[key].startTime});
}

/**
 * finish an explanation
 *
 * @param key --- key of the room
 * @return null
 */
function finishExplanation(key) {
    // if game has ended
    if (!(key in rooms)) {
        return;
    }

    // if signal has been sent
    if (rooms[key].substate !== "explanation") {
        return;
    }
    rooms[key].substate = "edit";

    // returning word to the hat
    if (rooms[key].word !== "") {
        rooms[key].freshWords.splice(
            Math.floor(Math.random() * Math.max(rooms[key].freshWords.length - 1, 0)),
            0, rooms[key].word);
    }

    rooms[key].startTime = 0;
    rooms[key].word = "";

    /**
     * Implementation of sExplanationEnded signal
     * @see API.md
     */
    io.sockets.to(key).emit("sExplanationEnded", {
        "wordsCount": rooms[key].freshWords.length});

    // generating editWords for client (without 'transport' flag)
    let editWords = [];
    for (let i = 0; i < rooms[key].editWords.length; ++i) {
        editWords.push({
            "word": rooms[key].editWords[i].word,
            "wordState": rooms[key].editWords[i].wordState});
    }

    /**
     * Implementation of sWordsToEdit signal
     * @see API.md
     */
    io.sockets.to(rooms[key].users[rooms[key].speaker].sids[0]).emit(
        "sWordsToEdit", {"editWords": editWords});
}

/**
 * end the game
 * @param key --- key of the room
 * @return none
 */
function endGame(key) {
    // preapring results
    let results = [];
    for (let i = 0; i < rooms[key].users.length; ++i) {
        results.push({
            "username": rooms[key].users[i].username,
            "scoreExplained": rooms[key].users[i].scoreExplained,
            "scoreGuessed": rooms[key].users[i].scoreGuessed});
    }

    // sorting results
    results.sort(function(a, b) {
        return 0 - (a.scoreExplained + a.scoreGuessed - b.scoreExplained - b.scoreGuessed);
    });

    /**
     * Implementation of sGameEnded signal
     * @see API.md
     */
    io.sockets.emit("sGameEnded", {"results": results});

    // removing room
    delete rooms[key];

    // removing users from room
    // don't working...
    /*
    io.sockets.clients(key).forEach(function(socket) {
        socket.leave(key);
    })
    */
}

//----------------------------------------------------------
// HTTP functions

/**
 * Implementation of getFreeKey function
 * @see API.md
 */
app.get("/getFreeKey", function(req, res) {
    /*
    Temporary measures.
    TODO: qualitative key generator
     */
    res.json({"key": Math.floor(Math.random() * 899999999 + 100000000).toString()});
});

/**
 * Implementation of getRoomInfo function
 * @see API.md
 */
app.get("/getRoomInfo", function(req, res) {
    const key = req.query.key; // The key of the room

    if (key === "") {
        res.json({"success": false});
        return;
    }

    // Case of nonexistent room
    if (!(key in rooms)) {
        res.json({"success": true,
                  "state": "wait",
                  "playerList": [],
                  "host": ""});
        return;
    }

    const room = rooms[key]; // The room
    switch (room.state) {
        case "wait":
        case "play":
            res.json({"success": true,
                      "state": "wait",
                      "playerList": getPlayerList(room),
                      "host": room.users[findFirstPos(room.users, "online", true)]});
            break;

        case "end":
            // TODO Implement
            res.json({"success": true, "state": "end"});
            console.log("WARN: getRoomInfo: You forgot to remove the room after the game ended!")
            break;

        default:
            console.log(room);
            break;
    }
});

//----------------------------------------------------------

/**
 * Dictionary of game rooms.
 * Its keys --- keys of rooms, its values --- rooms' infos.
 *
 * Room's info is an object that has fields:
 *     - state --- state of the room,
 *     - users --- list of users, each user has:
 *         - username --- no comments,
 *         - sids --- socket ids,
 *         - online --- whether the player is online,
 *         - scoreExplained --- no comments,
 *         - scoreGuessed --- no comments,
 * if state === "play":
 *     - substate --- substate of the room,
 *     - freshWords --- list of words in hat,
 *     - usedWords --- dictionary of words, that aren't in hat, its keys --- words, each has:
 *         - status --- word status,
 *     - speaker --- position of speaker,
 *     - listener --- position of listener,
 *     - speakerReady --- bool,
 *     - listenerReady --- bool,
 *     - word --- current word,
 *     - startTime --- UTC time of start of explanation (in miliseconds).
 *     - editWords --- list of words to edit
 *     - numberOfTurn --- number of turn
 */
const rooms = {};

//----------------------------------------------------------
// Socket.IO functions

io.on("connection", function(socket) {

    /**
     * Implementation of cJoinRoom function
     * @see API.md
     */
    socket.on("cJoinRoom", function(ev) {
        // If user is not in his own room, it will be an error
        if (getRoom(socket) !== socket.id) {
            socket.emit("sFailure", {"request": "cJoinRoom", "msg": "You are in room now"});
            return;
        }
        // If key is "" or name is "", it will be an error
        if (ev.key === "") {
            socket.emit("sFailure", {"request": "cJoinRoom", "msg": "Invalid key of room"});
            return;
        }
        if (ev.username === "") {
            socket.emit("sFailure", {"request": "cJoinRoom", "msg": "Invalid username"});
            return;
        }

        const key = ev.key.toLowerCase(); // key of the room
        const name = ev.username; // name of the user

        // if room and usrs exist, we should check the user
        if (rooms[key] !== undefined) {
            const pos = findFirstPos(rooms[key].users, "username", name);

            // If username is used, it will be an error
            if (pos !== -1 && rooms[key].users[pos].sids.length !== 0) {
                socket.emit("sFailure", {"request": "cJoinRoom", "msg": "Username is already used"});
                return;
            }

            // If game has started, only logging in can be perfomed
            if (rooms[key].state === "play" && pos === -1) {
                socket.emit("sFailure", {
                    "request": "cJoinRoom",
                    "msg": "Game have started, only logging in can be perfomed"});
                return;
            }
        }


        // Adding the user to the room
        socket.join(key, function(err) {
            // If any error happened
            if (err) {
                console.log(err);
                socket.emit("sFailure", {"request": "joinRoom", "msg": "Failed to join the room"});
                return;
            }
            // If user haven't joined the room
            if (getRoom(socket) !== key) {
                socket.emit("sFailure", {"request": "joinRoom", "msg": "Failed to join the room"});
                return;
            }

            // Logging the joining
            console.log("Player", name, "joined to", key);

            // If room isn't saved in main dictionary, let's save it and create info about it
            if (!(key in rooms)) {
                rooms[key] = {};
                rooms[key].state = "wait";
                rooms[key].users = [];
            }

            // Adding the user to the room info
            const pos = findFirstPos(rooms[key].users, "username", name);
            if (pos === -1) {
                // creating new one
                rooms[key].users.push({
                    "username": name,
                    "sids": [socket.id],
                    "online": true,
                    "scoreExplained": 0,
                    "scoreGuessed": 0});
            } else {
                // logging in user
                rooms[key].users[pos].sids = [socket.id];
                rooms[key].users[pos].online = true;
            }

            // If this user is the first online user, the user will be the host of the room
            let hostChanged = false;
            if (findFirstPos(rooms[key].users, "online", true) === findFirstPos(rooms[key].users, "username", name)) {
                hostChanged = true;
            }

            /**
             * Implementation of sPlayerJoined signal
             * @see API.md
             */
            io.sockets.to(key).emit(
                "sPlayerJoined", {"username": name, "playerList": getPlayerList(rooms[key]),
                "host": rooms[key].users[findFirstPos(rooms[key].users, "online", true)].username});

            /**
             * Implementation of sYouJoined signal
             * @see API.md
             */
            let joinObj = {
                "key": key,
                "playerList": getPlayerList(rooms[key]),
                "host": rooms[key].users[findFirstPos(rooms[key].users, "online", true)].username};
            switch (rooms[key].state) {
                case "wait":
                    joinObj.state = "wait";
                    break;
                case "play":
                    joinObj.state = "play";
                    joinObj.wordsCount = rooms[key].freshWords.length;
                    switch (rooms[key].substate) {
                        case "wait":
                            joinObj.substate = "wait";
                            joinObj.speaker =  rooms[key].users[rooms[key].speaker].username;
                            joinObj.listener =  rooms[key].users[rooms[key].listener].username;
                            break;
                        case "explanation":
                            joinObj.substate = "explanation";
                            joinObj.speaker =  rooms[key].users[rooms[key].speaker].username;
                            joinObj.listener =  rooms[key].users[rooms[key].listener].username;
                            joinObj.startTime = rooms[key].startTime;
                            joinObj.wordsCount++;
                            if (joinObj.speaker === name) {
                                joinObj.word = rooms[key].word;
                            }
                            break;
                        case "edit":
                            joinObj.substate = "edit";
                            joinObj.editWords = [];
                            break;
                        default:
                            console.log(rooms[key]);
                            break;
                    }
                    break;
                default:
                    console.log(rooms[key]);
                    break;
            }
            socket.emit("sYouJoined", joinObj);
        });
    });

    /**
     * Implementation of cLeaveRoom function
     * @see API.md
     */
    socket.on("cLeaveRoom", function() {
        const key = getRoom(socket); // Key of user's current room

        // If user is only in his own room
        if (key === socket.id) {
            socket.emit("sFailure", {"request": "cLeaveRoom", "msg": "you aren't in the room"});
            return;
        }

        // getting username
        const usernamePos = findFirstSidPos(rooms[key].users, socket.id);
        const username = rooms[key].users[usernamePos].username;

        // if username is ""
        if (username === "") {
            socket.emit("sFailure", {"request": "cLeaveRoom", "msg": "you aren't in the room"});
            return;
        }

        // Removing the user from the room
        socket.leave(key, function(err) {
            // If any error happened
            if (err) {
                socket.emit("sFailure", {"request": "cLeaveRoom", "msg": "failed to leave the room"});
                return;
            }

            // Logging the leaving
            console.log("Player", username, "left", key);

            // Removing the user from the room info
            rooms[key].users[usernamePos].online = false;
            rooms[key].users[usernamePos].sids = [];

            /**
             * Implementation of sPlayerLeft signal
             * @see API.md
             */
            // Sending new state of the room.
            let host = "";
            const pos = findFirstPos(rooms[key].users, "online", true);
            if (pos !== -1) {
                host = rooms[key].users[pos].username;
            }
            io.sockets.to(key).emit("sPlayerLeft", {
                "username": username, "playerList": getPlayerList(rooms[key]),
                "host": host});
        });
    });

    /**
     * Implementation of cStartGame function
     * @see API.md
     */
    socket.on("cStartGame", function() {
        // acquiring the key
        const key = getRoom(socket);

        // checking whether siganl owner is host
        const hostPos = findFirstPos(rooms[key].users, "online", true);
        if (hostPos === -1) {
            // very strange case, probably something went wrong, let's log it!
            console.log("cStartGame: Everyone is offline");
            socket.emit("sFailure", {"request": "cStartGame", "mgs": "Everyone is offline"});
            return;
        }
        if (rooms[key].users[hostPos].sids[0] !== socket.id) {
            socket.emit("sFailure", {"request": "cStartGame", "msg": "Only host can start the game"});
            return;
        }
        
        // if state isn't 'wait', something went wrong
        if (rooms[key].state !== "wait") {
            socket.emit("sFailure", {"request": "cStartGame", "msg": "Game have already started"});
            return;
        }

        // Fail if only one user is online
        let cnt = 0
        for (let i = 0; i < rooms[key].users.length; ++i) {
            if (rooms[key].users[i].online) {
                cnt++;
            }
        }
        if (cnt < 2) {
            socket.emit("sFailure", {
                "request": "cStartGame", 
                "msg": "Not enough online users to start the game (at least two required)"});
            return;
        }

        /**
         * kicking off offline users
         */
        // preparing containers
        let onlineUsers = [];

        // copying each user in proper container
        for (let i = 0; i < rooms[key].users.length; ++i) {
            if (rooms[key].users[i].online) {
                onlineUsers.push(rooms[key].users[i]);
            }
        }

        // removing offline users
        rooms[key].users = onlineUsers;

        /**
         * preparing room object for the game
         */
        // changing state to 'play'
        rooms[key].state = "play";

        // setting substate to 'wait'
        rooms[key].substate = "wait";

        // generating word list (later key can affect word list)
        rooms[key].freshWords = generateWords(key);

        // preparing storage for explained words
        rooms[key].usedWords = {};

        // preparing storage for words to edit
        rooms[key].editWords = [];

        // preparing word container
        rooms[key].word = "";

        // preparing endTime container
        rooms[key].startTime = 0;

        // setting number of turn
        rooms[key].numberOfTurn = 0;

        // preparing flags for 'wait'
        rooms[key].speakerReady = false;
        rooms[key].listenerReady = false;

        // preparing 'speaker' and 'listener'
        const numberOfPlayers = rooms[key].users.length;
        const nextPair = getNextPair(numberOfPlayers, numberOfPlayers - 1, numberOfPlayers - 2);
        rooms[key].speaker = nextPair.speaker;
        rooms[key].listener = nextPair.listener;

        /**
         * Implementation of sGameStarted signal
         * @see API.md
         */
        io.sockets.to(key).emit("sGameStarted", {
            "speaker": rooms[key].users[rooms[key].speaker].username,
            "listener": rooms[key].users[rooms[key].listener].username,
            "wordsCount": rooms[key].freshWords.length});
    });

    /**
     * Implementation of cSpeakerReady function
     * @see API.md
     */
    socket.on("cSpeakerReady", function() {
        const key = getRoom(socket); // key of room

        // the game must be in 'play' state
        if (rooms[key].state !== "play") {
            socket.emit("sFailure", {
                "request": "cListenerReady",
                "msg": "game state isn't 'play'"});
        }

        // the game substate must be 'wait'
        if (rooms[key].substate !== "wait") {
            socket.emit("sFailure", {
                "request": "cSpeakerReady",
                "msg": "game substate isn't 'wait'"});
            return;
        }

        // check whether the client is speaker
        if (rooms[key].users[rooms[key].speaker].sids[0] !== socket.id) {
            socket.emit("sFailure", {
                "request": "cSpeakerReady",
                "msg": "you aren't a speaker"});
            return;
        }

        // check if speaker isn't already ready
        if (rooms[key].speakerReady) {
            socket.emit("sFailure", {
                "request": "cSpeakerReady",
                "msg": "speaker is already ready"});
            return;
        }

        // setting flag for speaker
        rooms[key].speakerReady = true;

        // if listener is ready --- let's start!
        if (rooms[key].listenerReady) {
            startExplanation(key);
        }
    });

    /**
     * Implementation of cListenerReady function
     * @see API.md
     */
    socket.on("cListenerReady", function() {
        const key = getRoom(socket); // key of room

        // the game must be in 'play' state
        if (rooms[key].state !== "play") {
            socket.emit("sFailure", {
                "request": "cListenerReady",
                "msg": "game state isn't 'play'"});
        }

        // the game substate must be 'wait'
        if (rooms[key].substate !== "wait") {
            socket.emit("sFailure", {
                "request": "cListenerReady",
                "msg": "game substate isn't 'wait'"});
            return;
        }

        // check whether the client is listener
        if (rooms[key].users[rooms[key].listener].sids[0] !== socket.id) {
            socket.emit("sFailure", {
                "request": "cListenerReady",
                "msg": "you aren't a listener"});
            return;
        }

        // check if listener isn't already ready
        if (rooms[key].listenerReady) {
            socket.emit("sFailure", {
                "request": "cListenerReady",
                "msg": "listener is already ready"});
            return;
        }

        // setting flag for listener
        rooms[key].listenerReady = true;

        // if listener is ready --- let's start!
        if (rooms[key].speakerReady) {
            startExplanation(key);
        }
    });
    
    /**
     * Implementation of cEndWordExplanation function
     * @see API.md
     */
    socket.on("cEndWordExplanation", function(ev) {
        const key = getRoom(socket); // key of the room
        
        // checking if proper state and substate
        if (rooms[key].state !== "play") {
            socket.emit("sFailure", {
                "request": "cEndWordExplanation",
                "msg": "game state isn't 'play'"});
            return;
        }
        if (rooms[key].substate !== "explanation") {
            socket.emit("sFailure", {
                "request": "cEndWordExplanation",
                "msg": "game substate isn't 'explanation'"});
            return;
        }

        // chicking if speaker send this
        if (rooms[key].users[rooms[key].speaker].sids[0] !== socket.id) {
            socket.emit("sFailure", {
                "request": "cEndWordExplanation",
                "msg": "you aren't a listener"});
            return;
        }

        // checking if time is correct
        const date = new Date();
        if (date.getTime() < rooms[key].startTime) {
            socket.emit("sFailure", {
                "request": "cEndWordExplanation",
                "msg": "to early"});
            return;
        }

        let cause = ev.cause;
        switch (cause) {
            case "explained":
                // logging the word
                rooms[key].editWords.push({
                    "word": rooms[key].word,
                    "wordState": "explained",
                    "transfer": true});

                // removing the word from the 'word' container
                rooms[key].word = "";

                /**
                 * Implementation of sWordExplanationEnded signal
                 * @see API.md
                 */
                io.sockets.emit("sWordExplanationEnded", {
                    "cause": cause,
                    "wordsCount": rooms[key].freshWords.length});

                // checking the time
                if (date.getTime() > rooms[key].startTime + 1000 * EXPLANATION_LENGTH) {
                    // finishing the explanation
                    finishExplanation(key);
                    return;
                }

                // if words left --- time to finish the explanation
                if (rooms[key].freshWords.length === 0) {
                    finishExplanation(key);
                    return;
                }

                // emmiting new word
                rooms[key].word = rooms[key].freshWords.pop();
                socket.emit("sNewWord", {"word": rooms[key].word});
                return;
            case "mistake":
                // logging the word
                rooms[key].editWords.push({
                    "word": rooms[key].word,
                    "wordState": "mistake",
                    "transfer": true});

                // word don't go to the hat
                rooms[key].word = "";

                /**
                 * Implementation of sWordExplanationEnded signal
                 * @see API.md
                 */
                io.sockets.emit("sWordExplanationEnded", {
                    "cause": cause,
                    "wordsCount": rooms[key].freshWords.length});

                // finishing the explanation
                finishExplanation(key);
                return;
            case "notExplained":
                // logging the word
                rooms[key].editWords.push({
                    "word": rooms[key].word,
                    "wordState": "notExplained",
                    "transfer": true});

                /**
                 * Implementation of sWordExplanationEnded signal
                 * @see API.md
                 */
                io.sockets.emit("sWordExplanationEnded", {
                    "cause": cause,
                    "wordsCount": rooms[key].freshWords.length + 1});

                // finishing the explanation
                finishExplanation(key);
                return;
        }
    });

    /**
     * Implementation of cWordsEdited function
     * @see API.md
     */
    socket.on("cWordsEdited", function(ev) {
        const key = getRoom(socket); // key of the room

        // check if game state is 'edit'
        if (rooms[key].state === "edit") {
            socket.emit("sFailure", {
                "request": "cWordsEdited",
                "msg": "game state isn't 'edit'"})
            return;
        }

        // check if game substate is 'edit'
        if (rooms[key].substate !== "edit") {
            socket.emit("sFailure", {
                "request": "cWordsEdited",
                "msg": "game substate isn't 'edit'"})
            return;
        }

        // check if speaker send this signal
        if (rooms[key].users[rooms[key].speaker].sids[0] !== socket.id) {
            socket.emit("sFailure", {
                "request": "cWordsEdited",
                "msg": "only speaker can send this signal"});
            return;
        }

        // moving editWords
        const editWords = ev.editWords;

        // comparing the legth of serer editWords and client editWords
        if (editWords.length !== rooms[key].editWords.length) {
            socket.emit("sFailure", {
                "request": "cWordsEdited",
                "msg": "incorrect number of words"});
            return;
        }

        // applying changes and counting success explanations
        let cnt = 0;
        for (let i = 0; i < editWords.length; ++i) {
            let word = rooms[key].editWords[i];
            
            // checking matching of information
            if (word.word !== editWords[i].word) {
                socket.emit("sFailure", {
                    "request": "cWordsEdited",
                    "msg": `incorrect word at position ${i}`});
                return;
            }

            switch (editWords[i].wordState) {
                case "explained":
                    // counting explained words
                    cnt++;
                case "mistake":
                    // transfering data to serer structure
                    rooms[key].editWords[i].wordState = editWords[i].wordState;
                    break;
                case "notExplained":
                    // returning not explained words to the hat
                    rooms[key].editWords[i].transfer = false;
                    break;
            }
        }

        // tranfering round info
        // changing the score
        rooms[key].users[rooms[key].speaker].scoreExplained += cnt;
        rooms[key].users[rooms[key].listener].scoreGuessed += cnt;

        // changing usedWords and creating words list
        let words = [];
        for (let i = 0; i < rooms[key].editWords.length; ++i) {
            if (rooms[key].editWords[i].transfer) {
                rooms[key].usedWords[rooms[key].editWords[i].word] = rooms[key].editWords[i].wordState;
                words.push({
                    "word": rooms[key].editWords[i].word,
                    "wordState": rooms[key].editWords[i].wordState});
            } else {
                rooms[key].freshWords.splice(
                    Math.floor(Math.random() * Math.max(rooms[key].freshWords.length - 1, 0)),
                    0, rooms[key].editWords[i].word);
            }
        }

        // if no words left it's time to finish the game
        if (rooms[key].freshWords.length === 0) {
            endGame(key);
            return;
        }

        // initializing next round
        rooms[key].substate = "wait";
        rooms[key].editWords = [];
        rooms[key].word = "";
        rooms[key].startTime = 0;
        rooms[key].speakerReady = false;
        rooms[key].listenerReady = false;
        rooms[key].numberOfTurn++;

        // choosing next pair
        const numberOfPlayers = rooms[key].users.length;
        const nextPair = getNextPair(numberOfPlayers, rooms[key].speaker, rooms[key].listener);
        rooms[key].speaker = nextPair.speaker;
        rooms[key].listener = nextPair.listener;

        /**
         * Implementation of sNextTurn signal
         * @see API.md
         */
        io.sockets.to(key).emit("sNextTurn", {
            "speaker": rooms[key].users[rooms[key].speaker].username,
            "listener": rooms[key].users[rooms[key].listener].username,
            "words": words});
    });

    socket.on("disconnect", function() {
        /**
         * room key can't be acceessed via getRoom(socket)
         * findFirstSidPos must be used intead
         */

        let key = [];
        let username = [];
        let usernamePos = [];
        let keys = Object.keys(rooms);
        // searching for given sid within all rooms
        for (let i = 0; i < keys.length; ++i) {
            const users = rooms[keys[i]].users;

            const pos = findFirstSidPos(users, socket.id);
            if (pos !== -1) {
                key.push(keys[i]);
                usernamePos.push(pos);
                username.push(users[usernamePos].username);
            }
        }

        // users wasn't logged in
        if (key.length === 0) {
            return;
        }

        for (let i = 0; i < key.length; ++i) {
            let _key = key[i];
            let _username = username[i];
            let _usernamePos = usernamePos[i];
            
            // Logging the disconnection
            console.log("Player", _username, "disconnected", _key);

            // Removing the user from the room info
            rooms[_key].users[_usernamePos].online = false;
            rooms[_key].users[_usernamePos].sids = [];

            /**
             * Implementation of sPlayerLeft signal
             * @see API.md
             */
            // Sending new state of the room.
            let host = "";
            const pos = findFirstPos(rooms[_key].users, "online", true);
            if (pos !== -1) {
                host = rooms[_key].users[pos].username;
            }
            io.sockets.to(_key).emit("sPlayerLeft", {
                "username": username, "playerList": getPlayerList(rooms[_key]),
                "host": host});
        }
    });
});
