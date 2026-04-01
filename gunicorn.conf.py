import multiprocessing

# Server Socket
bind = "127.0.0.1:8000"
backlog = 2048

# Oracle free tier VMs vary. ARM instances have 24GB RAM, but AMD "micro"
# instances only have 1GB. To prevent OOM-kills, we use a conservative count.
# A private dashboard really only needs 2 workers.
workers = min((multiprocessing.cpu_count() * 2) + 1, 2)
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
