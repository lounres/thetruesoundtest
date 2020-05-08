const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('DB.sqlite');

const request = require('request');
request('http://the-hat.appspot.com/api/v2/dictionary/ru', function (error, response, body) {
    // console.log('Status:', response.statusCode);
    // console.log('Headers:', response.headers);
    // console.log('Response:', JSON.parse(body));
    db.serialize(function () {
        db.run("BEGIN;")
        JSON.parse(body).forEach((word) => {
            db.run("INSERT INTO Words VALUES (?,?,?,?);",
                word.word,
                word.diff,
                word.used,
                word.tags)
        })
        db.run("COMMIT;")
    })
});

// db.each("SELECT * FROM Customers", function (err, row) {
//     if (err) {
//         throw err
//     }
//     console.log(row)
// })