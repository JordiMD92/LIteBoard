from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import json

app = Flask(__name__, static_folder=None) # We will handle static files manually
CORS(app)

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

@app.route('/api/dashboard/<dashboard_id>', methods=['GET'])
def get_dashboard(dashboard_id):
    file_path = os.path.join(DATA_DIR, f"{dashboard_id}.json")
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    else:
        # Return a default structure if the dashboard doesn't exist
        return jsonify({"dashboards": [], "settings": { "version": 2 }})

@app.route('/api/dashboard/<dashboard_id>', methods=['POST'])
def save_dashboard(dashboard_id):
    file_path = os.path.join(DATA_DIR, f"{dashboard_id}.json")
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid data"}), 400
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=2)
    return jsonify({"message": "Dashboard saved successfully"})

# --- Static file serving ---
# Serve the main index.html at the root
@app.route('/')
def root():
    return send_from_directory('.', 'index.html')

# Serve any other file from the root directory
@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    # Running on port 8000
    app.run(host='0.0.0.0', port=8000)
