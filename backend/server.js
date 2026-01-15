const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Basic route for the root URL
app.get('/', (req, res) => {
    res.send('The Echo Mirror Backend is Running!');
});

// Initialize SQLite database
const db = new sqlite3.Database('./echo_mirror.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS sound_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            type TEXT,
            frequency TEXT
        )`, (createErr) => {
            if (createErr) {
                console.error('Error creating table:', createErr.message);
            } else {
                console.log('Sound events table created or already exists.');
            }
        });
    }
});

// API endpoint to get sound events
app.get('/api/sound-events', (req, res) => {
    db.all("SELECT * FROM sound_events ORDER BY id DESC LIMIT 10", [], (err, rows) => {
        if (err) {
            res.status(400).json({"error": err.message});
            return;
        }
        res.json({
            "message": "success",
            "data": rows
        });
    });
});

// API endpoint to add a new sound event
app.post('/api/sound-events', (req, res) => {
    const { timestamp, type, frequency } = req.body;
    db.run(`INSERT INTO sound_events (timestamp, type, frequency) VALUES (?, ?, ?)`, 
           [timestamp, type, frequency], 
           function (err) {
        if (err) {
            res.status(400).json({"error": err.message});
            return;
        }
        res.json({
            "message": "success",
            "data": {
                id: this.lastID,
                timestamp: timestamp,
                type: type,
                frequency: frequency
            }
        });
    });
});

// API endpoint to clear all sound events
app.post('/api/clear-events', (req, res) => {
    db.run("DELETE FROM sound_events", [], function (err) {
        if (err) {
            res.status(400).json({"error": err.message});
            return;
        }
        res.json({"message": "Timeline cleared successfully", "changes": this.changes});
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
