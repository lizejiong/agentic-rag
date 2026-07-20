import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('stores passwords as Argon2id hashes and verifies them', async () => {
    const passwordHash = await passwords.hash('correct horse battery staple');

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(passwords.verify(passwordHash, 'correct horse battery staple')).resolves.toBe(
      true,
    );
    await expect(passwords.verify(passwordHash, 'wrong password')).resolves.toBe(false);
  });
});
