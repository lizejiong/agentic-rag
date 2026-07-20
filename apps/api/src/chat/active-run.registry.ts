import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';

type ActiveRun = {
  controller: AbortController;
  userId: string;
};

@Injectable()
export class ActiveRunRegistry {
  private readonly controllers = new Map<string, ActiveRun>();

  start(requestId: string, userId: string): AbortController {
    if (this.controllers.has(requestId)) {
      throw new ConflictException('REQUEST_ALREADY_RUNNING');
    }
    const controller = new AbortController();
    this.controllers.set(requestId, { controller, userId });
    return controller;
  }

  abort(requestId: string, userId: string): boolean {
    const active = this.controllers.get(requestId);
    if (!active) {
      return false;
    }
    if (active.userId !== userId) {
      throw new ForbiddenException('RUN_CANCELLATION_DENIED');
    }
    active.controller.abort();
    return true;
  }

  finish(requestId: string, controller: AbortController): void {
    if (this.controllers.get(requestId)?.controller === controller) {
      this.controllers.delete(requestId);
    }
  }
}
