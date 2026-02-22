import multiprocessing

# Server Socket
bind = "127.0.0.1:8000"
backlog = 2048

# Worker Processes
# Oracle free tier VMs are robust on RAM but limited on CPU. 
# (2 * cores) + 1 is the standard formula
workers = (multiprocessing.cpu_count() * 2) + 1
worker_class = 'sync'
worker_connections = 1000
timeout = 120
keepalive = 2

# Logging
accesslog = '-'
errorlog = '-'
loglevel = 'info'

# Process Naming
proc_name = 'mygarmindash'
