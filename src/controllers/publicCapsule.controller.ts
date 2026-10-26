import type { Request, Response } from 'express';

import { publicCapsuleService } from '../services/publicCapsule.service';

export const publicCapsuleController = {
  async open(req: Request<{ token: string }>, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const capsule = await publicCapsuleService.open(req.params.token);
    res.status(200).json(capsule);
  },
};
