import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { InfraModule } from '../infra.module.js';
import { AuthController, AuthService } from './auth/auth.controller.js';
import { AccessService } from './common/access.service.js';
import { SessionGuard } from './common/auth.js';
import { FitnessController } from './fitness/fitness.controller.js';
import { GroupsController } from './groups/groups.controller.js';
import { DrainState, HealthController } from './health/health.controller.js';
import { MeController } from './me/me.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NutritionController } from './nutrition/nutrition.controller.js';
import { TasksController } from './tasks/tasks.controller.js';
import { TasksService } from './tasks/tasks.service.js';
import { LiveController, LiveService } from './live/live.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';

@Module({
  imports: [InfraModule],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    GroupsController,
    TasksController,
    FitnessController,
    NutritionController,
    NotificationsController,
    WebhooksController,
    LiveController,
  ],
  providers: [
    // Every route needs a signed-in user unless marked @Public().
    { provide: APP_GUARD, useClass: SessionGuard },
    DrainState,
    AccessService,
    AuthService,
    TasksService,
    LiveService,
  ],
})
export class AppModule {}
