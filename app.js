// Entry point for Phusion Passenger / cPanel "Setup Node.js App": point the
// panel's startup file here. Passenger sets PORT and supervises the process;
// all state stays in data/, so several workers are fine.
import { start } from './server/index.js'

start()
