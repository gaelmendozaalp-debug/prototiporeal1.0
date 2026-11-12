const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Activity = require('../models/Activity');
const ServiceTimer = require('../models/ServiceTimer');
const Setting = require('../models/Setting');
const Reflection = require('../models/Reflection');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET;

function createToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// 1. Registro de nuevo usuario
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, institution, programName } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre es obligatorio' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'El correo electrónico es obligatorio' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Ya existe una cuenta con este correo electrónico' });
    }

    const user = new User({
      name: name.trim(),
      email: cleanEmail,
      password,
      institution: institution?.trim() || 'Universidad',
      programName: programName?.trim() || 'Servicio Social con Propósito'
    });

    await user.save();

    // Crear configuración y actividad de bienvenida inicial para este usuario
    await Setting.create({
      userId: user._id,
      key: 'theme',
      value: 'dark'
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    await Activity.create({
      userId: user._id,
      id: `welcome-${Date.now().toString(36)}`,
      title: '¡Bienvenido a SnapDuty! Explora tu agenda',
      date: todayStr,
      category: 'Educación',
      start: '09:00',
      end: '10:00',
      priority: 'high',
      notes: 'Esta es tu primera actividad personal guardada en tu sesión.',
      done: false
    });

    const token = createToken(user);

    res.status(201).json({
      success: true,
      message: 'Cuenta creada exitosamente',
      token,
      user
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Inicio de sesión
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Ingresa correo y contraseña' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' });
    }

    const token = createToken(user);

    res.json({
      success: true,
      message: `¡Bienvenido de nuevo, ${user.name}!`,
      token,
      user
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Acceso rápido con cuenta Demo
router.post('/demo', async (req, res) => {
  try {
    const demoEmail = 'estudiante.demo@snapduty.com';
    let user = await User.findOne({ email: demoEmail });

    if (!user) {
      user = await User.create({
        name: 'Estudiante Demo',
        email: demoEmail,
        password: 'PasswordDemo123!',
        institution: 'Facultad de Ciencias y Humanidades',
        programName: 'Brigada de Asistencia Comunitaria y Educación'
      });

      // Crear actividades y datos de muestra para el usuario demo
      const today = new Date().toISOString().slice(0, 10);
      await Activity.create([
        {
          userId: user._id,
          id: 'demo-act-1',
          title: 'Taller de apoyo escolar comunitario',
          date: today,
          category: 'Educación',
          start: '09:00',
          end: '11:00',
          priority: 'high',
          notes: 'Lectura guiada y regularización de matemáticas.',
          done: true
        },
        {
          userId: user._id,
          id: 'demo-act-2',
          title: 'Entrega de paquetes de útiles escolares',
          date: today,
          category: 'Atención comunitaria',
          start: '11:30',
          end: '13:00',
          priority: 'medium',
          notes: 'Módulo de atención en el centro vecinal.',
          done: false
        }
      ]);

      await ServiceTimer.create({
        userId: user._id,
        date: today,
        startAt: Date.now() - 3600000,
        notified: false,
        notes: 'Jornada demo en curso'
      });

      await Setting.create([
        { userId: user._id, key: 'theme', value: 'dark' },
        { userId: user._id, key: 'reflection', value: 'El servicio social me ha permitido conectar con realidades distintas y poner mis conocimientos al servicio de los demás.' }
      ]);
    }

    const token = createToken(user);
    res.json({
      success: true,
      message: 'Sesión iniciada con cuenta Demo',
      token,
      user
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Perfil del usuario autenticado
router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// 5. Actualizar perfil o metas
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, institution, programName, dailyHours, weeklyHours, totalHours } = req.body;
    const user = req.user;

    if (name) user.name = name.trim();
    if (institution !== undefined) user.institution = institution.trim();
    if (programName !== undefined) user.programName = programName.trim();
    if (dailyHours !== undefined) user.dailyHours = Number(dailyHours);
    if (weeklyHours !== undefined) user.weeklyHours = Number(weeklyHours);
    if (totalHours !== undefined) user.totalHours = Number(totalHours);

    await user.save();

    res.json({
      success: true,
      message: 'Perfil actualizado exitosamente',
      user
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
