import { trustProxyHops } from './security';

describe('trustProxyHops', () => {
  const original = process.env.TRUST_PROXY_HOPS;

  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = original;
  });

  it('defaults to a single proxy', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(trustProxyHops()).toBe(1);
  });

  it('reads the configured number of proxies', () => {
    process.env.TRUST_PROXY_HOPS = '2';
    expect(trustProxyHops()).toBe(2);
  });

  it.each(['abc', '-1', '1.5', ''])('falls back to one proxy for %p', (value) => {
    process.env.TRUST_PROXY_HOPS = value;
    expect(trustProxyHops()).toBe(1);
  });
});
