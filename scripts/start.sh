#!/bin/sh
set -e

# Start the API server in background
cd /app/server && node dist/server.js &
API_PID=$!

# Start the frontend server
serve -s /app/frontend/dist -l 3000 &
FRONTEND_PID=$!

# Handle termination signals
trap 'kill $API_PID $FRONTEND_PID 2>/dev/null; exit 0' SIGTERM SIGINT

# Wait for any process to exit
wait -n 2>/dev/null || wait

# Exit with status of process that exited first
exit $?
