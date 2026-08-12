import { AUDITED_METHODS, domainFromPath, pickRecordId } from '../audit.util';

describe('audit.util', () => {
  it('picks a uuid record id from a response body', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    expect(pickRecordId({ id: uuid })).toBe(uuid);
    expect(pickRecordId({ entryId: uuid })).toBe(uuid);
    expect(pickRecordId({ id: 'not-a-uuid' })).toBeNull();
    expect(pickRecordId(null)).toBeNull();
    expect(pickRecordId('x')).toBeNull();
  });

  it('derives a domain from the path, ignoring the api prefix', () => {
    expect(domainFromPath('/api/sales/payments')).toBe('sales');
    expect(domainFromPath('/api/admin/members')).toBe('admin');
    expect(domainFromPath('/company')).toBe('company');
    expect(domainFromPath('/api')).toBe('unknown');
  });

  it('audits only mutating methods', () => {
    expect(AUDITED_METHODS.has('POST')).toBe(true);
    expect(AUDITED_METHODS.has('DELETE')).toBe(true);
    expect(AUDITED_METHODS.has('GET')).toBe(false);
  });
});
