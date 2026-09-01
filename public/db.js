const sqlite3 = require('sqlite3').verbose();

// créer ou ouvrir la base
const db = new sqlite3.Database('./game.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT)");
});

module.exports = db;