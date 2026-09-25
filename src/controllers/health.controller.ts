import type { Request, Response } from 'express';

import { healthService } from '../services/health.service';

export const healthController = {
  check(_req: Request, res: Response): void {
    res.status(200).json(healthService.getStatus());
  },
};
