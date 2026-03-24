# WhatsApp Marketing Tool Backend

Custom Node.js/Express backend for the WhatsApp Marketing API Tool.

## Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configure `.env`**:
    Update the `.env` file with your SQL Server and Cloudinary credentials.

3.  **Run migrations**:
    Run the `sqlserver_setup.sql` script on your SQL Server instance.

4.  **Start the server**:
    ```bash
    npm start
    ```

## API Endpoints

-   `POST /api/auth/register`: Register a new user.
-   `POST /api/auth/login`: Login and get a JWT token.
-   `POST /api/whatsapp/send-message`: Send a single WhatsApp message.
-   `POST /api/webhook`: WhatsApp webhook for incoming messages.
-   `POST /api/storage/upload`: Upload media to Cloudinary.
