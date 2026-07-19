import { Global, Module } from '@nestjs/common';

import { ENVIRONMENT, loadWorkspaceEnvironment, parseEnvironment } from './environment';

@Global()
@Module({
  providers: [
    {
      provide: ENVIRONMENT,
      useFactory: () => {
        loadWorkspaceEnvironment();
        return parseEnvironment();
      },
    },
  ],
  exports: [ENVIRONMENT],
})
export class ConfigurationModule {}
