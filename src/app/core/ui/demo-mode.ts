import { environment } from '../../../environments/environment';

/** True only in the presentation build, where an in-browser mock stands in for the server. */
export const DEMO_MODE: boolean = environment.useMockBackend;
