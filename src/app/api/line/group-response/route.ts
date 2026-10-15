// Explicit LINE group-response endpoint. It shares signature validation and
// command handling with the existing webhook so both URLs behave identically.
export { POST } from '../webhook/route';
