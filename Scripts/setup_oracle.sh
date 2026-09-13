#!/bin/bash
# Ensure standard paths are available
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
# Setup script for MyGarminDash on Oracle Linux (Ubuntu)

echo "🚀 Starting MyGarminDash Setup..."

# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install dependencies
sudo apt install -y python3-pip python3-venv git nginx

# 3. Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

# 4. Setup Service & Sudoers Permission for Self-Update
echo "⚙️ Configuring Systemd Service..."
sudo cp garmin.service /etc/systemd/system/garmin.service
sudo systemctl daemon-reload
sudo systemctl enable garmin.service

echo "ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart garmin.service, /usr/bin/systemctl restart garmin.service" | sudo tee /etc/sudoers.d/garmin_update
sudo chmod 0440 /etc/sudoers.d/garmin_update

# 5. Setup Nginx
echo "🌐 Configuring Nginx..."
sudo cp nginx.conf /etc/nginx/sites-available/mygarmindash
sudo ln -s /etc/nginx/sites-available/mygarmindash /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo "✅ Setup complete! Use 'sudo systemctl start garmin.service' to launch."
echo "💡 Remember to create your .env file with your GARMIN and AI keys."
