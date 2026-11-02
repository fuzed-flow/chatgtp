import { fixture } from './mockDb';
export const useAuth = () => ({ profile: { id: 'sample-user', company_id: fixture.companyId, full_name: 'Sample team member', email: 'sample@example.invalid' } });
