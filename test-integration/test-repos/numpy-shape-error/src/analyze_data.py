#!/usr/bin/env python3
"""
Data analysis module with intentional NumPy shape errors for Deebo testing.
"""

import numpy as np
import matplotlib.pyplot as plt
from time import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class DataAnalyzer:
    """Analyze scientific data with matrix operations."""
    
    def __init__(self, data_dims=(10, 5), feature_dims=(5, 20)):
        """Initialize with data dimensions."""
        self.data = np.random.randn(*data_dims)  # Shape: (10, 5)
        self.features = np.random.randn(*feature_dims)  # Shape: (5, 20)
        logger.info(f"Initialized data with shape {self.data.shape}")
        logger.info(f"Initialized features with shape {self.features.shape}")
        
    def transform_data(self):
        """Apply feature transformation to data (intentional shape error)."""
        logger.info("Transforming data...")
        
        # BUG: Incorrect matrix multiplication (shape mismatch)
        # Should be: result = np.dot(self.data, self.features)
        # This will fail because shapes (10,5) and (5,20) are correct for matrix multiplication
        # but we're using the wrong operation
        result = self.data * self.features  # Broadcasting error!
        
        logger.info(f"Transformation result shape: {result.shape}")
        return result
    
    def reduce_dimensions(self, data):
        """Reduce dimensions with PCA-like operation (intentional axis error)."""
        logger.info("Reducing dimensions...")
        
        # BUG: Incorrect axis in mean calculation
        # Should be: centered = data - data.mean(axis=0)
        centered = data - data.mean(axis=1)  # Wrong axis for centering
        
        # Calculate covariance (will fail due to wrong centering)
        cov = np.dot(centered.T, centered)
        
        logger.info(f"Covariance matrix shape: {cov.shape}")
        return cov
    
    def extract_features(self, data):
        """Extract top features from data (intentional indexing error)."""
        logger.info("Extracting features...")
        
        # BUG: Incorrect indexing for multi-dimensional array
        # Shape confusion with transpose operation
        # Should be: transposed = data.T
        transposed = data[np.newaxis, :, :]  # Wrong indexing operation
        
        logger.info(f"Transposed data shape: {transposed.shape}")
        return transposed
    
    def visualize_results(self, data):
        """Create visualization (intentional broadcasting error)."""
        logger.info("Visualizing results...")
        
        # Generate some coordinates for plotting
        x = np.linspace(0, 10, 10)
        y = np.linspace(0, 20, 5)
        
        # BUG: Broadcasting error with meshgrid
        # Should be: X, Y = np.meshgrid(x, y)
        # Instead doing manual outer product with wrong dimensions
        X = x[:, np.newaxis]
        Y = y  # Wrong shapes for broadcasting
        
        # This will fail because X and Y can't be broadcast together
        Z = X + Y
        
        logger.info(f"Visualization grid shape: {Z.shape}")
        return Z
        
    def run_analysis(self):
        """Run the full analysis pipeline."""
        logger.info("Starting analysis...")
        
        start_time = time()
        
        try:
            # This will fail with a shape error
            transformed = self.transform_data()
            reduced = self.reduce_dimensions(transformed)
            features = self.extract_features(reduced)
            visualization = self.visualize_results(features)
            
            logger.info(f"Analysis complete in {time() - start_time:.2f} seconds")
            return visualization
            
        except Exception as e:
            logger.error(f"Analysis failed: {str(e)}")
            raise

if __name__ == "__main__":
    logger.info("Initializing data analyzer...")
    analyzer = DataAnalyzer()
    
    try:
        result = analyzer.run_analysis()
        logger.info(f"Final result shape: {result.shape}")
        
        # Plot the results
        plt.figure(figsize=(10, 8))
        plt.imshow(result, cmap='viridis')
        plt.colorbar()
        plt.title('Analysis Result')
        plt.savefig('analysis_result.png')
        plt.close()
        
    except Exception as e:
        logger.error(f"Fatal error in analysis: {str(e)}")