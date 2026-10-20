import { Router } from 'express';
import 'dotenv/config';

const router = Router();

// GET /api/boostr/:patente
router.get('/:patente', async (req, res, next) => {
  try {
    const { patente } = req.params;

    const response = await fetch(
      `https://api.boostr.cl/vehicle/${patente}.json`,
      {
        headers: {
          'X-API-KEY': process.env.BOOSTR_API_KEY,
          'accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return res.status(404).json({
        success: false,
        error: 'Vehículo no encontrado en Boostr',
      });
    }

    const data = await response.json();

    res.json({
      success: true,
      data: data.data,
    });
  } catch (error) {
    next(error);
  }
});

export default router;