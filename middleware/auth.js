// middleware/auth.js
const jwt = require('jsonwebtoken');

function authorize(roles = []) {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Accesso negato. Token mancante.' });

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      // Controllo del ruolo
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ message: 'Vietato. Non hai i permessi necessari.' });
      }

      next();
    } catch (err) {
      return res.status(403).json({ message: 'Token non valido.' });
    }
  };
}

module.exports = authorize;
