import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class ActiveRunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  start(requestId: string): AbortController {
    if (this.controllers.has(requestId)) {
      throw new ConflictException('REQUEST_ALREADY_RUNNING');
    }
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    return controller;
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort();
  }

  finish(requestId: string, controller: AbortController): void {
    if (this.controllers.get(requestId) === controller) {
      this.controllers.delete(requestId);
    }
  }
}
