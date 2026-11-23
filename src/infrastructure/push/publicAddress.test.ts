import { describe, expect, it } from 'vitest'
import { isPublicAddress } from './publicAddress'

describe('isPublicAddress: where the box may connect', () => {
  it.each([
    '8.8.8.8',
    '142.250.74.110',
    '17.253.144.10',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '2001:4860:4860::8888',
    '2a00:1450:4007:80f::200e',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('takes the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it.each([
    ['unspecified', '0.0.0.0'],
    ['"this network"', '0.1.2.3'],
    ['loopback', '127.0.0.1'],
    ['loopback elsewhere in /8', '127.255.255.254'],
    ['private 10/8', '10.0.0.1'],
    ['private 172.16/12 low', '172.16.0.1'],
    ['private 172.16/12 high', '172.31.255.255'],
    ['private 192.168/16', '192.168.1.1'],
    ['shared 100.64/10', '100.64.0.1'],
    ['shared 100.64/10 high', '100.127.255.255'],
    ['link-local and cloud metadata', '169.254.169.254'],
    ['protocol assignments', '192.0.0.8'],
    ['TEST-NET-1', '192.0.2.1'],
    ['benchmarking', '198.18.0.1'],
    ['benchmarking high', '198.19.255.255'],
    ['TEST-NET-2', '198.51.100.7'],
    ['TEST-NET-3', '203.0.113.9'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 unspecified', '::'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique local', 'fc00::1'],
    ['IPv6 unique local fd', 'fd12:3456:789a::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 link-local with a zone', 'fe80::1%eth0'],
    ['IPv6 site-local', 'fec0::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['mapped loopback', '::ffff:127.0.0.1'],
    ['mapped private', '::ffff:10.0.0.1'],
    ['mapped private in hex', '::ffff:a00:1'],
    ['mapped metadata', '::ffff:169.254.169.254'],
    ['NAT64 of a private address', '64:ff9b::a00:1'],
    ['documentation 3fff::/20', '3fff:ffff::1'],
    ['not global unicast', '4000::1'],
    ['a name', 'localhost'],
    ['nothing', ''],
    ['an almost address', '8.8.8'],
    ['an octal-looking address', '0177.0.0.1'],
    ['an address with a port', '8.8.8.8:443'],
  ])('refuses %s (%s)', (_name, address) => {
    expect(isPublicAddress(address)).toBe(false)
  })
})
