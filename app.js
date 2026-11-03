require('dotenv').config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const connectToDatabase = require('./database');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function ensureDatabaseConnection(req, res, next) {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error('Error al conectar a MongoDB:', error.message);
    res.status(503).json({ success: false, error: 'Base de datos no disponible' });
  }
}

app.use('/api/auth', ensureDatabaseConnection, authRoutes);
app.use('/api', ensureDatabaseConnection, apiRoutes);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'intex.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'prueba prototipo.html'));
});

module.exports = app;
