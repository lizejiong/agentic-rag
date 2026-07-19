import { parseEnvironment } from './environment';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://atlas:secret@127.0.0.1:55432/atlas_rag',
  REDIS_URL: 'redis://:secret@127.0.0.1:56379',
  AI_SERVICE_URL: 'http://127.0.0.1:8001',
  JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters',
  JWT_REFRESH_PEPPER: 'refresh-pepper-with-at-least-32-characters',
  COOKIE_SECURE: 'false',
};

describe('parseEnvironment', () => {
  it('parses a valid local environment', () => {
    expect(parseEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3000,
      COOKIE_SECURE: false,
    });
  });

  it('rejects shared access and refresh secrets', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        JWT_REFRESH_PEPPER: validEnvironment.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/must be different/);
  });

  it('rejects example secrets in production', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret-with-32-characters',
      }),
    ).toThrow(/example secrets/);
  });

  it('requires bootstrap administrator credentials as a pair', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        BOOTSTRAP_ADMIN_USERNAME: 'admin',
      }),
    ).toThrow(/configured together/);
  });
});
