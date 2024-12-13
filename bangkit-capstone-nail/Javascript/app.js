const express = require('express');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const mysql = require('mysql2');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');
const app = express();
const port = 3000;

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'db_nail',
    port: 3306
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err.message);
        return;
    }
    console.log('Connected to MySQL database');
});

const storage = new Storage({ keyFilename: 'gcp-key.json' });
const bucketName = 'fiona-capstone-bucket';
const bucket = storage.bucket(bucketName);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/register', upload.none(), async (req, res) => {
    const { email, username, password, confirmPassword } = req.body;

    if (!email || !username || !password || !confirmPassword) {
        return res.status(400).json({
            status: 'error',
            message: 'field tidak boleh kosong!',
            data: null
        });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({
            status: 'error',
            message: 'password and confirm password tidak sama',
            data: null
        });
    }

    const checkQuery = 'SELECT * FROM users WHERE email = ?';
    db.query(checkQuery, [email], async (err, results) => {
        if (err) {
            console.error('Error querying database:', err.message);
            return res.status(500).json({
                status: 'error',
                message: 'internal server error',
                data: null
            });
        }

        if (results.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'email sudah terpakai',
                data: null
            });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const insertQuery = 'INSERT INTO users (email, username, password) VALUES (?, ?, ?)';
        db.query(insertQuery, [email, username, hashedPassword], (err, result) => {
            if (err) {
                console.error('Error inserting user into database:', err.message);
                return res.status(500).json({
                    status: 'error',
                    message: 'internal server error',
                    data: null
                });
            }

            res.status(201).json({
                status: 'success',
                message: 'registrasi berhasil',
                data: { 
                    id: result.insertId,
                    username: username,
                    email: email
                }
            });
        });
    });
});

app.post('/login', upload.none(), (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            status: 'error',
            message: 'email atau password tidak boleh kosong',
            data: null
        });
    }

    const query = 'SELECT id, username, email, password FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) {
            console.error('Error querying database:', err.message);
            return res.status(500).json({
                status: 'error',
                message: 'internal server error',
                data: null
            });
        }

        if (results.length === 0) {
            return res.status(401).json({
                status: 'error',
                message: 'email atau password salah',
                data: null
            });
        }

        const user = results[0];

        const isPasswordValid = bcrypt.compareSync(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                status: 'error',
                message: 'email atau password salah',
                data: null
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'login berhasil',
            data: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    });
});

app.post('/logout', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'logout berhasil',
        data: null
    });
});

app.post('/predict', upload.single('file'), async (req, res) => {
    const  userId  = req.body.user_id;

    if (!req.file) {
        return res.status(400).json({
            status: 'error',
            message: 'file tidak ditemukan',
            data: null,
        });
    }

    const formData = new FormData();
    formData.append('file', req.file.buffer, req.file.originalname);

    try {
        const response = await axios.post(
            'http://127.0.0.1:5000/predict',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                },
            }
        );

        console.log(response.data.prediction);

        const blob = bucket.file(Date.now() + path.extname(req.file.originalname));
        const blobStream = blob.createWriteStream({
            resumable: false,
            contentType: req.file.mimetype,
        });

        blobStream.on('error', (err) => {
            console.error('Error uploading file to GCS:', err.message);
            res.status(500).json({ 
                message: 'internal server error',
                status: 'error',
            });
        });

        blobStream.on('finish', () => {
            const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;

            const query = 'INSERT INTO predictions (confidence, description, url, user_id) VALUES (?, ?, ?, ?)';
            db.query(query, [response.data.prediction, response.data.description, publicUrl, userId], (err, result) => {
                if (err) {
                    console.error('Error inserting data into database:', err.message);
                    res.status(500).json({
                        message: 'internal server error',
                        status: 'error',
                    })
                    return;
                }

                res.status(200).send({
                    message: 'prediksi berhasil',
                    status: 'success',
                    data: {
                        prediction: response.data.prediction.toExponential(),
                        description: response.data.description,
                        url: publicUrl
                    },
                });
            });
        });

        blobStream.end(req.file.buffer);
    } catch (error) {
        console.error('Error calling Flask API:', error.message);

        if (error.response) {
            return res.status(error.response.status).json(error.response.data);
        } else {
            return res.status(500).json({
                status: 'error',
                message: 'internal server error',
                data: null,
            });
        }
    }
});

app.get('/history/:userId', (req, res) => {
    const userId = req.params.userId;

    const query = 'SELECT * FROM predictions WHERE user_id = ?';
    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error('Error querying database:', err.message);
            return res.status(500).json({
                status: 'error',
                message: 'internal server error',
                data: null,
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'riwayat prediksi kosong',
                data: null,
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'berhasil mendapatkan data',
            data: results,
        });
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:3000');
});
