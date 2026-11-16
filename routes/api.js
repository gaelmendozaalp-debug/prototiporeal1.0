const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const ServiceTimer = require('../models/ServiceTimer');
const HistoricalServiceHours = require('../models/HistoricalServiceHours');
const MonthlyServiceAdvance = require('../models/MonthlyServiceAdvance');
const Setting = require('../models/Setting');
const Reflection = require('../models/Reflection');
const authMiddleware = require('../middleware/auth');

// Helper to calculate hours between "HH:mm" and "HH:mm"
function calculateHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
  return diffMinutes > 0 ? Number((diffMinutes / 60).toFixed(2)) : 0;
}

function workedHours(timer, now = Date.now()) {
  const elapsedMs = Number.isFinite(Number(timer.elapsedMs))
    ? Number(timer.elapsedMs)
    : Number(timer.hoursWorked || 0) * 3600000;
  const activeSince = timer.activeSince ?? (!timer.pausedAt && !timer.endAt ? timer.startAt : null);
  const activeMs = activeSince ? Math.max(0, now - Number(activeSince)) : 0;
  return Math.max(0, elapsedMs + activeMs) / 3600000;
}

function isValidMonth(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return false;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const parsed = new Date(Date.UTC(year, monthNumber - 1, 1));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === monthNumber - 1;
}

// 1. Health & Connection Status (Público)
router.get('/status', async (req, res) => {
  try {
    const [actCount, timerCount, reflectCount] = await Promise.all([
      Activity.countDocuments(),
      ServiceTimer.countDocuments(),
      Reflection.countDocuments()
    ]);

    res.json({
      status: 'ok',
      database: 'MongoDB',
      connected: true,
      authEnabled: true,
      totalSystemRecords: {
        activities: actCount,
        serviceTimers: timerCount,
        reflections: reflectCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// A partir de aquí, todas las rutas de datos son privadas y específicas para cada sesión/usuario
router.use(authMiddleware);

// 2. Full Bootstrap Data por usuario
router.get('/bootstrap', async (req, res) => {
  try {
    const userId = req.user._id;

    const [activities, timersList, historicalHoursList, monthlyAdvancesList, themeSetting, reflectionSetting, interfaceSetting, recentReflections] = await Promise.all([
      Activity.find({ userId }).sort({ date: 1, start: 1 }).lean(),
      ServiceTimer.find({ userId }).lean(),
      HistoricalServiceHours.find({ userId }).sort({ date: -1 }).lean(),
      MonthlyServiceAdvance.find({ userId }).sort({ monthKey: -1 }).select('_id months monthKey hours').lean(),
      Setting.findOne({ userId, key: 'theme' }).lean(),
      Setting.findOne({ userId, key: 'reflection' }).lean(),
      Setting.findOne({ userId, key: 'interface' }).lean(),
      Reflection.find({ userId }).sort({ date: -1 }).limit(10).lean()
    ]);

    const serviceTimers = {};
    for (const t of timersList) {
      serviceTimers[t.date] = {
        startAt: t.startAt,
        activeSince: t.activeSince ?? null,
        pausedAt: t.pausedAt ?? null,
        elapsedMs: t.elapsedMs ?? 0,
        targetHours: t.targetHours ?? 4,
        endAt: t.endAt || null,
        hoursWorked: t.hoursWorked || 0,
        notified: !!t.notified,
        notes: t.notes || ''
      };
    }

    res.json({
      success: true,
      data: {
        user: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          institution: req.user.institution,
          programName: req.user.programName
        },
        goals: {
          dailyHours: req.user.dailyHours || 4,
          weeklyHours: req.user.weeklyHours || 20,
          totalHours: req.user.totalHours || 480
        },
        activities: activities.map(a => ({
          id: a.id,
          title: a.title,
          date: a.date,
          category: a.category,
          start: a.start || "",
          end: a.end || "",
          priority: a.priority,
          notes: a.notes || "",
          done: !!a.done,
          createdAt: a.createdAt
        })),
        serviceTimers,
        historicalServiceHours: Object.fromEntries(historicalHoursList.map(entry => [entry.date, entry.hours])),
        monthlyServiceAdvances: monthlyAdvancesList.map(entry => ({
          id: String(entry._id),
          months: entry.months,
          monthKey: entry.monthKey,
          hours: entry.hours
        })),
        theme: themeSetting ? themeSetting.value : 'dark',
        interfacePreferences: interfaceSetting ? interfaceSetting.value : null,
        reflection: reflectionSetting ? reflectionSetting.value : "",
        reflections: recentReflections
      }
    });
  } catch (error) {
    console.error('Error al obtener bootstrap data del usuario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Actividades del usuario autenticado
router.get('/activities', async (req, res) => {
  try {
    const userId = req.user._id;
    const { date, startDate, endDate, category, status, search } = req.query;
    const filter = { userId };

    if (date) {
      filter.date = date;
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }

    if (category && category !== 'all' && category !== 'Todas') {
      filter.category = category;
    }

    if (status === 'done') {
      filter.done = true;
    } else if (status === 'pending') {
      filter.done = false;
    }

    if (search && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { notes: { $regex: term, $options: 'i' } }
      ];
    }

    const activities = await Activity.find(filter).sort({ date: 1, start: 1 });
    res.json({ success: true, count: activities.length, activities });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/activities', async (req, res) => {
  try {
    const userId = req.user._id;
    const { id, title, date, category, start, end, priority, notes, done, createdAt } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'El título es obligatorio' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Fecha inválida (requiere YYYY-MM-DD)' });
    }
    if (Boolean(start) !== Boolean(end)) {
      return res.status(400).json({ success: false, error: 'Completa ambas horas o deja ambas vacías' });
    }
    if (start && end && end <= start) {
      return res.status(400).json({ success: false, error: 'La hora de término debe ser posterior a la de inicio' });
    }

    const activityId = id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    const activity = await Activity.findOneAndUpdate(
      { userId, id: activityId },
      {
        $set: {
          userId,
          title: title.trim().slice(0, 120),
          date,
          category: category || 'Otro',
          start: start || '',
          end: end || '',
          priority: priority || 'medium',
          notes: (notes || '').trim().slice(0, 500),
          done: Boolean(done)
        },
        $setOnInsert: {
          id: activityId,
          createdAt: createdAt ? new Date(createdAt) : new Date()
        }
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    res.status(201).json({ success: true, activity });
  } catch (error) {
    console.error('Error al guardar actividad:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/activities/:id', async (req, res) => {
  try {
    const activity = await Activity.findOne({ userId: req.user._id, id: req.params.id });
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Actividad no encontrada' });
    }
    res.json({ success: true, activity });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/activities/:id', async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { title, date, category, start, end, priority, notes, done } = req.body;

    if (title && !title.trim()) {
      return res.status(400).json({ success: false, error: 'El título no puede estar vacío' });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Fecha inválida' });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim().slice(0, 120);
    if (date !== undefined) updateData.date = date;
    if (category !== undefined) updateData.category = category;
    if (start !== undefined) updateData.start = start;
    if (end !== undefined) updateData.end = end;
    if (priority !== undefined) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes.trim().slice(0, 500);
    if (done !== undefined) updateData.done = Boolean(done);

    const activity = await Activity.findOneAndUpdate(
      { userId, id },
      { $set: updateData },
      { returnDocument: 'after', runValidators: true }
    );

    if (!activity) {
      return res.status(404).json({ success: false, error: 'Actividad no encontrada' });
    }

    res.json({ success: true, activity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.patch('/activities/:id/toggle', async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const activity = await Activity.findOne({ userId, id });
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Actividad no encontrada' });
    }

    activity.done = !activity.done;
    await activity.save();

    res.json({ success: true, activity });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/activities/:id', async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const result = await Activity.findOneAndDelete({ userId, id });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Actividad no encontrada' });
    }
    res.json({ success: true, message: 'Actividad eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sincronización masiva para el usuario
router.post('/activities/bulk-sync', async (req, res) => {
  try {
    const userId = req.user._id;
    const { activities } = req.body;
    if (!Array.isArray(activities)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo de actividades' });
    }

    const operations = activities.map(act => ({
      updateOne: {
        filter: { userId, id: act.id },
        update: {
          $setOnInsert: {
            userId,
            id: act.id,
            title: act.title,
            date: act.date,
            category: act.category,
            start: act.start || '',
            end: act.end || '',
            priority: act.priority || 'medium',
            notes: act.notes || '',
            done: !!act.done,
            createdAt: act.createdAt ? new Date(act.createdAt) : new Date()
          }
        },
        upsert: true
      }
    }));

    if (operations.length > 0) {
      await Activity.bulkWrite(operations);
    }

    const all = await Activity.find({ userId }).sort({ date: 1 });
    res.json({ success: true, activities: all });
  } catch (error) {
    console.error('Error en bulk-sync de actividades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Jornadas Diarias / Cronómetro del usuario
router.get('/timers', async (req, res) => {
  try {
    const userId = req.user._id;
    const timers = await ServiceTimer.find({ userId }).sort({ date: 1 });
    if (req.query.format === 'list') {
      return res.json({ success: true, timers });
    }

    const timerMap = {};
    for (const t of timers) {
      timerMap[t.date] = {
        startAt: t.startAt,
        activeSince: t.activeSince ?? null,
        pausedAt: t.pausedAt ?? null,
        elapsedMs: t.elapsedMs ?? 0,
        targetHours: t.targetHours ?? 4,
        endAt: t.endAt || null,
        hoursWorked: t.hoursWorked || 0,
        notified: t.notified,
        notes: t.notes || ''
      };
    }
    res.json({ success: true, timers: timerMap });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/timers', async (req, res) => {
  try {
    const userId = req.user._id;
    const { date, startAt, activeSince, pausedAt, elapsedMs, targetHours, endAt, hoursWorked, notified, notes } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Fecha de jornada inválida' });
    }
    if (!startAt || !Number.isFinite(Number(startAt))) {
      return res.status(400).json({ success: false, error: 'Hora de inicio inválida' });
    }

    const timer = await ServiceTimer.findOneAndUpdate(
      { userId, date },
      {
        $set: {
          userId,
          date,
          startAt: Number(startAt),
          activeSince: activeSince !== undefined ? (activeSince === null ? null : Number(activeSince)) : Number(startAt),
          pausedAt: pausedAt ? Number(pausedAt) : null,
          elapsedMs: elapsedMs !== undefined ? Math.max(0, Number(elapsedMs)) : 0,
          targetHours: targetHours !== undefined ? Math.min(12, Math.max(1, Number(targetHours))) : 4,
          endAt: endAt ? Number(endAt) : null,
          hoursWorked: hoursWorked !== undefined ? Number(hoursWorked) : 0,
          notified: Boolean(notified),
          notes: notes || ''
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    res.status(201).json({ success: true, timer });
  } catch (error) {
    console.error('Error al guardar jornada:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.patch('/timers/:date', async (req, res) => {
  try {
    const userId = req.user._id;
    const { date } = req.params;
    const { notified, startAt, activeSince, pausedAt, elapsedMs, targetHours, endAt, hoursWorked, notes } = req.body;

    const update = {};
    if (notified !== undefined) update.notified = Boolean(notified);
    if (startAt !== undefined) update.startAt = Number(startAt);
    if (activeSince !== undefined) update.activeSince = activeSince === null ? null : Number(activeSince);
    if (pausedAt !== undefined) update.pausedAt = pausedAt === null ? null : Number(pausedAt);
    if (elapsedMs !== undefined) update.elapsedMs = Math.max(0, Number(elapsedMs));
    if (targetHours !== undefined) update.targetHours = Math.min(12, Math.max(1, Number(targetHours)));
    if (endAt !== undefined) update.endAt = endAt === null ? null : Number(endAt);
    if (hoursWorked !== undefined) update.hoursWorked = Number(hoursWorked);
    if (notes !== undefined) update.notes = String(notes);

    const timer = await ServiceTimer.findOneAndUpdate(
      { userId, date },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!timer) {
      return res.status(404).json({ success: false, error: 'Jornada no encontrada' });
    }

    res.json({ success: true, timer });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/timers/:date', async (req, res) => {
  try {
    const userId = req.user._id;
    const { date } = req.params;
    await ServiceTimer.findOneAndDelete({ userId, date });
    res.json({ success: true, message: 'Jornada reiniciada / eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/timers/bulk-sync', async (req, res) => {
  try {
    const userId = req.user._id;
    const { timers } = req.body;
    if (!timers || typeof timers !== 'object') {
      return res.status(400).json({ success: false, error: 'Se esperaba un objeto de jornadas' });
    }

    const operations = Object.entries(timers).map(([date, t]) => ({
      updateOne: {
        filter: { userId, date },
        update: {
          $setOnInsert: {
            userId,
            date,
            startAt: Number(t.startAt),
            activeSince: t.activeSince !== undefined ? t.activeSince : Number(t.startAt),
            pausedAt: t.pausedAt ?? null,
            elapsedMs: Math.max(0, Number(t.elapsedMs || 0)),
            targetHours: t.targetHours !== undefined ? Math.min(12, Math.max(1, Number(t.targetHours))) : 4,
            notified: !!t.notified
          }
        },
        upsert: true
      }
    }));

    if (operations.length > 0) {
      await ServiceTimer.bulkWrite(operations);
    }

    const all = await ServiceTimer.find({ userId });
    const timerMap = {};
    for (const t of all) {
      timerMap[t.date] = {
        startAt: t.startAt,
        activeSince: t.activeSince ?? null,
        pausedAt: t.pausedAt ?? null,
        elapsedMs: t.elapsedMs ?? 0,
        targetHours: t.targetHours ?? 4,
        endAt: t.endAt || null,
        hoursWorked: t.hoursWorked || 0,
        notified: t.notified,
        notes: t.notes || ''
      };
    }
    res.json({ success: true, timers: timerMap });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/historical-hours/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const hours = Number(req.body.hours);
    const [year, month, day] = date.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
      && parsedDate.getUTCFullYear() === year
      && parsedDate.getUTCMonth() === month - 1
      && parsedDate.getUTCDate() === day;

    const latestDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!validDate || date > latestDate) {
      return res.status(400).json({ success: false, error: 'La fecha debe ser válida y no puede estar en el futuro' });
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return res.status(400).json({ success: false, error: 'Las horas deben ser mayores que 0 y no exceder 24' });
    }

    const updates = { userId: req.user._id, date, hours };
    if (req.body.evidence !== undefined) {
      const match = typeof req.body.evidence === 'string'
        ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body.evidence)
        : null;
      if (!match || req.body.evidence.length > 900000) {
        return res.status(400).json({ success: false, error: 'La evidencia debe ser una imagen JPEG válida y no exceder el tamaño permitido' });
      }

      const image = Buffer.from(match[1], 'base64');
      if (image.length > 512 * 1024 || image.length < 3 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
        return res.status(400).json({ success: false, error: 'La evidencia debe ser una imagen JPEG válida y no exceder el tamaño permitido' });
      }
      updates.evidence = req.body.evidence;
    }

    const entry = await HistoricalServiceHours.findOneAndUpdate(
      { userId: req.user._id, date },
      { $set: updates },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    res.json({ success: true, entry: { date: entry.date, hours: entry.hours } });
  } catch (error) {
    console.error('Error al guardar horas históricas de servicio:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/historical-hours/:date/evidence', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'La fecha no es válida' });
    }

    const entry = await HistoricalServiceHours.findOne(
      { userId: req.user._id, date },
      { evidence: 1, _id: 0 }
    ).lean();
    res.json({ success: true, evidence: entry?.evidence || null });
  } catch (error) {
    console.error('Error al obtener evidencia de horas históricas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/monthly-advances', async (req, res) => {
  try {
    if (!Array.isArray(req.body.months) || req.body.months.length === 0 || req.body.months.length > 120) {
      return res.status(400).json({ success: false, error: 'Selecciona uno o varios meses válidos' });
    }

    const months = [...new Set(req.body.months)].sort();
    if (months.length !== req.body.months.length || !months.every(isValidMonth)) {
      return res.status(400).json({ success: false, error: 'Selecciona uno o varios meses válidos' });
    }
    const latestMonth = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
    if (months.some(month => month > latestMonth)) {
      return res.status(400).json({ success: false, error: 'No puedes seleccionar meses futuros' });
    }

    const hours = Number(req.body.hours);
    if (!Number.isInteger(hours) || hours <= 0) {
      return res.status(400).json({ success: false, error: 'Las horas deben ser enteras y mayores que 0' });
    }

    const monthKey = months.join(',');
    const overlapping = await MonthlyServiceAdvance.find({
      userId: req.user._id,
      months: { $in: months }
    }).select('_id months').lean();
    if (overlapping.length > 1 || (overlapping.length === 1 && !overlapping[0].months.every(month => months.includes(month)))) {
      return res.status(409).json({
        success: false,
        error: 'Para actualizar este registro, selecciona todos sus meses y agrega los nuevos si hace falta.'
      });
    }

    const updates = { userId: req.user._id, months, monthKey, hours };
    if (req.body.evidence !== undefined) {
      const match = typeof req.body.evidence === 'string'
        ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body.evidence)
        : null;
      if (!match || req.body.evidence.length > 900000) {
        return res.status(400).json({ success: false, error: 'La evidencia debe ser una imagen JPEG válida y no exceder el tamaño permitido' });
      }

      const image = Buffer.from(match[1], 'base64');
      if (image.length > 512 * 1024 || image.length < 3 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
        return res.status(400).json({ success: false, error: 'La evidencia debe ser una imagen JPEG válida y no exceder el tamaño permitido' });
      }
      updates.evidence = req.body.evidence;
    }

    const existing = overlapping[0];
    const advance = await MonthlyServiceAdvance.findOneAndUpdate(
      existing ? { _id: existing._id, userId: req.user._id } : { userId: req.user._id, monthKey },
      { $set: updates },
      { upsert: !existing, returnDocument: 'after', runValidators: true }
    );
    res.json({
      success: true,
      advance: {
        id: String(advance._id),
        months: advance.months,
        monthKey: advance.monthKey,
        hours: advance.hours
      }
    });
  } catch (error) {
    console.error('Error al guardar adelanto mensual de horas:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/monthly-advances/evidence', async (req, res) => {
  try {
    const rawMonths = typeof req.query.months === 'string' ? req.query.months.split(',') : [];
    const months = [...new Set(rawMonths)].sort();
    if (months.length === 0 || months.length > 120 || months.length !== rawMonths.length || !months.every(isValidMonth)) {
      return res.status(400).json({ success: false, error: 'Selecciona uno o varios meses válidos' });
    }

    const overlapping = await MonthlyServiceAdvance.find({
      userId: req.user._id,
      months: { $in: months }
    }).select('months evidence').lean();
    if (overlapping.length > 1) {
      return res.status(409).json({ success: false, error: 'Hay más de un registro que coincide con esos meses.' });
    }
    const existing = overlapping[0];
    const evidence = existing && existing.months.every(month => months.includes(month))
      ? existing.evidence || null
      : null;
    res.json({ success: true, evidence });
  } catch (error) {
    console.error('Error al obtener evidencia del adelanto mensual:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/historical-hours/:date', async (req, res) => {
  try {
    const result = await HistoricalServiceHours.findOneAndDelete({
      userId: req.user._id,
      date: req.params.date
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Registro histórico no encontrado' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar horas históricas de servicio:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Ajustes y Preferencias del usuario
router.get('/settings/:key', async (req, res) => {
  try {
    const setting = await Setting.findOne({ userId: req.user._id, key: req.params.key });
    res.json({ success: true, key: req.params.key, value: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/settings/:key', async (req, res) => {
  try {
    const userId = req.user._id;
    const { key } = req.params;
    const { value } = req.body;

    const setting = await Setting.findOneAndUpdate(
      { userId, key },
      { userId, key, value },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({ success: true, setting });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 6. Metas del usuario autenticado
router.get('/goals', async (req, res) => {
  res.json({
    success: true,
    goals: {
      dailyHours: req.user.dailyHours || 4,
      weeklyHours: req.user.weeklyHours || 20,
      totalHours: req.user.totalHours || 480,
      institution: req.user.institution,
      programName: req.user.programName
    }
  });
});

router.put('/goals', async (req, res) => {
  try {
    const { dailyHours, weeklyHours, totalHours } = req.body;
    const user = req.user;

    if (dailyHours !== undefined) user.dailyHours = Number(dailyHours);
    if (weeklyHours !== undefined) user.weeklyHours = Number(weeklyHours);
    if (totalHours !== undefined) user.totalHours = Number(totalHours);

    await user.save();

    res.json({
      success: true,
      goals: {
        dailyHours: user.dailyHours,
        weeklyHours: user.weeklyHours,
        totalHours: user.totalHours
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 7. Bitácora / Reflexiones del usuario
router.get('/reflections', async (req, res) => {
  try {
    const reflections = await Reflection.find({ userId: req.user._id }).sort({ date: -1, createdAt: -1 });
    res.json({ success: true, count: reflections.length, reflections });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/reflections', async (req, res) => {
  try {
    const userId = req.user._id;
    const { id, date, title, content, category, hoursLogged } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'El contenido de la reflexión es obligatorio' });
    }

    const reflectionId = id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const reflection = await Reflection.findOneAndUpdate(
      { userId, id: reflectionId },
      {
        $set: {
          userId,
          date: date || new Date().toISOString().slice(0, 10),
          title: (title || 'Reflexión de servicio').trim(),
          content: content.trim(),
          category: category || 'General',
          hoursLogged: Number(hoursLogged) || 0
        },
        $setOnInsert: { id: reflectionId }
      },
      { upsert: true, returnDocument: 'after' }
    );

    await Setting.findOneAndUpdate(
      { userId, key: 'reflection' },
      { userId, key: 'reflection', value: content.trim() },
      { upsert: true }
    );

    res.status(201).json({ success: true, reflection });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/reflections/:id', async (req, res) => {
  try {
    const result = await Reflection.findOneAndDelete({ userId: req.user._id, id: req.params.id });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Reflexión no encontrada' });
    }
    res.json({ success: true, message: 'Reflexión eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Estadísticas e Impacto del usuario en tiempo real
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user._id;

    const [activities, timers, historicalHours, monthlyAdvances] = await Promise.all([
      Activity.find({ userId }).lean(),
      ServiceTimer.find({ userId }).lean(),
      HistoricalServiceHours.find({ userId }).lean(),
      MonthlyServiceAdvance.find({ userId }).select('hours').lean()
    ]);

    const totalActivities = activities.length;
    const completedActivities = activities.filter(a => a.done).length;
    const pendingActivities = totalActivities - completedActivities;

    let totalActivityHours = 0;
    const categoryStats = {
      "Atención comunitaria": { count: 0, hours: 0 },
      "Educación": { count: 0, hours: 0 },
      "Gestión": { count: 0, hours: 0 },
      "Investigación": { count: 0, hours: 0 },
      "Otro": { count: 0, hours: 0 }
    };

    const activeDates = new Set();

    for (const a of activities) {
      activeDates.add(a.date);
      const hrs = calculateHours(a.start, a.end);
      if (a.done) {
        totalActivityHours += hrs;
      }
      const cat = categoryStats[a.category] ? a.category : 'Otro';
      categoryStats[cat].count += 1;
      if (a.done) {
        categoryStats[cat].hours += hrs;
      }
    }

    let totalTimerHours = 0;
    const now = Date.now();
    for (const t of timers) {
      activeDates.add(t.date);
      const hours = workedHours(t, now);
      totalTimerHours += Number(hours.toFixed(2));
    }
    for (const entry of historicalHours) {
      activeDates.add(entry.date);
      totalTimerHours += Number(entry.hours.toFixed(2));
    }
    for (const advance of monthlyAdvances) {
      totalTimerHours += Number(advance.hours.toFixed(2));
    }

    const totalGoal = req.user.totalHours || 480;

    res.json({
      success: true,
      stats: {
        totalActivities,
        completedActivities,
        pendingActivities,
        completionRate: totalActivities > 0 ? Number(((completedActivities / totalActivities) * 100).toFixed(1)) : 0,
        totalActivityHours: Number(totalActivityHours.toFixed(2)),
        totalTimerHours: Number(totalTimerHours.toFixed(2)),
        totalImpactHours: Number((totalActivityHours + totalTimerHours).toFixed(2)),
        activeDaysCount: activeDates.size,
        categoryStats,
        goals: {
          dailyGoal: req.user.dailyHours || 4,
          weeklyGoal: req.user.weeklyHours || 20,
          totalGoal,
          totalProgressPercent: Number(((totalTimerHours / totalGoal) * 100).toFixed(1))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
