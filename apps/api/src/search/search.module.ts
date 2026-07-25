import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchTestController } from './search-test.controller';

@Module({
  controllers: [SearchController, SearchTestController],
})
export class SearchModule {}
