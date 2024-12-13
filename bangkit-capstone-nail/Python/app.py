from flask import Flask, request, jsonify
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model
from PIL import Image
import io

app = Flask(__name__)

# Register custom functions
from keras.saving import register_keras_serializable

@register_keras_serializable()
def mse(y_true, y_pred):
    return tf.reduce_mean(tf.square(y_true - y_pred))

# Function to load the model
def load_model_from_h5(model_path):
    try:
        model = load_model(model_path, custom_objects={'mse': mse})
        print(f"Registered custom functions: {tf.keras.losses.get('mse')}")
        print("Model loaded successfully.")
        print(f"Model input shape: {model.input_shape}")
        return model
    except Exception as e:
        print(f"Error loading model: {e}")
        raise e

# Load the Keras model (adjust the model file name as needed)
model = load_model_from_h5('nail_identification.h5')

@app.route('/')
def home():
    return "Welcome to the Flask API for Image Prediction!"

@app.route('/predict', methods=['POST'])
def predict():
    try:
        # Ensure an image file is in the request
        if 'file' not in request.files:
            return jsonify({
                'status': 'error',
                'message': 'No file part'
            }), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({
                'status': 'error',
                'message': 'No selected file'
            }), 400

        # Open the image
        image = Image.open(file.stream)

        # Ensure the image has 3 channels (RGB)
        if image.mode != 'RGB':
            image = image.convert('RGB')

        # Resize the image to the required dimensions (150x150)
        image = image.resize((150, 150))

        # Convert the image to a NumPy array and normalize
        img_array = np.array(image) / 255.0

        # Add a batch dimension
        img_array = np.expand_dims(img_array, axis=0)

        # Make a prediction
        prediction = model.predict(img_array)

        # Assuming the model outputs a single value as the prediction
        result = float(prediction[0][0])
        
        if result < 0.01:  # Angka sangat kecil
            description = "Kuku Anda Bermasalah!"
        elif result >= 0.01:  # Angka mendekati 1
            description = "Kuku Anda Dalam Kondisi Bagus!"

        return jsonify({
            'status': 'success',
            'prediction': result,
            'description': description
        })

    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000, debug=True)
