# ChromaDB Ingestion Script

This Python script, `ingest_chroma.py`, is responsible for populating a ChromaDB vector database with data.

## Primary Usage

This script is designed to be executed primarily by the Node.js script `ingest-chroma.ts` located in the main CantoLyr API project. It serves as the data ingestion pipeline for the vector search functionality.

## Rationale for Using Python

The natural question arises: why use a separate Python script when the main API is built in Node.js? The primary reason is performance and hardware utilization.

The process of generating vector embeddings for the data is computationally intensive. Python's ecosystem for machine learning and scientific computing is mature and highly optimized. Specifically, libraries like `sentence-transformers` can leverage hardware acceleration (e.g., using a GPU/CUDA) to significantly speed up the embedding generation process. Achieving this level of performance and direct hardware access is more complex and less supported in the Node.js ecosystem.

By delegating this heavy lifting to a specialized Python script, we get the best of both worlds: the robust and efficient web framework of Node.js for the API and the high-performance ML capabilities of Python for the data ingestion pipeline.

## Independent Usage

While its main purpose is to be called from the Node.js environment, the script can also be run independently for testing, development, or manual data ingestion.

### Prerequisites

- Python 3.x
- A running ChromaDB instance

### Setup and Execution

1. **Create and activate a virtual environment:**

    It is highly recommended to use a virtual environment to manage dependencies and avoid conflicts.

    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    ```

2. **Install dependencies:**

    Install the required Python packages from the `requirements.txt` file.

    ```bash
    pip install -r requirements.txt
    ```

3. **Run the script:**

    Once the dependencies are installed, you can execute the script directly.

    ```bash
    python ingest_chroma.py
    ```

## Embedding Model (Qwen3-Embedding-0.6B)

- Default model: `Qwen/Qwen3-Embedding-0.6B` via Hugging Face.
- Loading strategy: tries `sentence-transformers` first, then falls back to Transformers with mean pooling.
- `EMBED_DIM`: leave empty to auto-infer from the model output; or set explicitly (e.g., `EMBED_DIM=1536`).
- Auth: if the model is gated, set `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` and accept the license on Hugging Face.
