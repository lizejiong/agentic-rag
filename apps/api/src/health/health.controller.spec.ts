import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports live and ready', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = module.get(HealthController);

    expect(controller.live()).toEqual({ status: 'live' });
    expect(controller.ready()).toEqual({ status: 'ready' });
  });
});
