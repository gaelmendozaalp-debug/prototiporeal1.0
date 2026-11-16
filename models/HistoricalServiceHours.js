const mongoose = require('mongoose');

const HistoricalServiceHoursSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: String,
    required: [true, 'La fecha es obligatoria (YYYY-MM-DD)'],
    index: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido']
  },
  hours: {
    type: Number,
    required: [true, 'Las horas son obligatorias'],
    min: 0.01,
    max: 24
  },
  evidence: {
    type: String,
    maxlength: 900000
  }
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

HistoricalServiceHoursSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('HistoricalServiceHours', HistoricalServiceHoursSchema);
