const mongoose = require('mongoose');

const MonthlyServiceAdvanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  months: {
    type: [String],
    required: true,
    validate: {
      validator: months => Array.isArray(months)
        && months.length > 0
        && months.length <= 120
        && new Set(months).size === months.length
        && months.every(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)),
      message: 'Selecciona uno o varios meses válidos'
    }
  },
  monthKey: {
    type: String,
    required: true
  },
  hours: {
    type: Number,
    required: [true, 'Las horas son obligatorias'],
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Las horas deben ser enteras'
    }
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
      delete ret.evidence;
      return ret;
    }
  }
});

MonthlyServiceAdvanceSchema.index({ userId: 1, monthKey: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyServiceAdvance', MonthlyServiceAdvanceSchema);
