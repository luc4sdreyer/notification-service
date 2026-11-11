import { Router } from 'express';
import type { components } from '../generated/api.js';
import type { CreateNotificationInput, NotificationService } from '../service/notificationService.js';

type CreateResponse = components['schemas']['CreateNotificationResponse'];
type StatusResponse = components['schemas']['NotificationStatusResponse'];

// Request shapes are already enforced by the OpenAPI validator before these handlers run.
export function notificationRoutes(service: NotificationService): Router {
  const router = Router();

  router.post('/notifications', async (req, res) => {
    const notification = await service.create(req.body as CreateNotificationInput);
    const body: CreateResponse = { id: notification.id, status: notification.status };
    res.status(202).location(`/notifications/${notification.id}`).json(body);
  });

  router.get('/notifications/:id', async (req, res) => {
    const notification = await service.get(req.params.id);
    const body: StatusResponse = {
      id: notification.id,
      channel: notification.channel,
      status: notification.status,
    };
    res.json(body);
  });

  return router;
}
