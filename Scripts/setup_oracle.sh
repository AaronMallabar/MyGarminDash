#!/bash
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

# 4. Setup Service
echo "⚙️ Configuring Systemd Service..."
sudo cp garmin.service /etc/systemd/system/garmin.service
sudo systemctl daemon-reload
sudo systemctl enable garmin.service

# 5. Setup Nginx
echo "🌐 Configuring Nginx..."
sudo cp nginx.conf /etc/nginx/sites-available/mygarmindash
sudo ln -s /etc/nginx/sites-available/mygarmindash /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo "✅ Setup complete! Use 'sudo systemctl start garmin.service' to launch."
echo "💡 Remember to create your .env file with your GARMIN and AI keys."
