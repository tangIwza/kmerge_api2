import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  it('getHello returns Hello World! and logs it', () => {
    const result = service.getHello();
    console.log('[AppService.getHello] result =', result);
    expect(result).toBe('Hello World!');
  });

  it.each([
    { case: 'baseline', expected: 'Hello World!' },
    { case: 'repeat call', expected: 'Hello World!' },
  ])('logs table-driven case: %o', ({ case: label, expected }) => {
    console.log('[Case]', label);
    const result = service.getHello();
    console.log('[Expected]', expected, '| [Received]', result);
    expect(result).toBe(expected);
  });
});

