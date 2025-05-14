#!/bin/bash

echo "Installing dependencies..."
pip install -r requirements.txt

echo "Running data analysis..."
python src/analyze_data.py