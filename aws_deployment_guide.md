# Deploy Liquidation Bot to AWS (1-Year Free Tier)

## Step 1: Create AWS Account (5 min)

1. Go to **[aws.amazon.com](https://aws.amazon.com/)**
2. Click **Create an AWS Account**.
3. Follow the prompts to create your account.
4. Enter your credit/debit card for verification.
   * **Note:** AWS usually places exactly a **$1.00 USD (~25,000 VND)** temporary authorization hold to verify the card. This is released back to your bank within a few days. You will not be billed as long as you stay within the free tier limits.

---

## Step 2: Create a Free VM (EC2 Instance)

1. Log into the AWS Management Console.
2. In the search bar at the top, type **EC2** and click the first result.
3. Click the orange **Launch instance** button.
4. Configure the instance using these settings:

| Setting | Value |
|---|---|
| Name | `liquidator-bot` |
| Application and OS Images | Select **Ubuntu**. Ensure the version says **"Free tier eligible"** (usually Ubuntu Server 24.04 LTS or 22.04 LTS). |
| Instance type | **t2.micro** or **t3.micro** (Look for the "Free tier eligible" tag). |
| Key pair (login) | Click **Create new key pair**. <br> Name: `aws-key` <br> Type: **RSA** <br> Format: **.pem**. <br> *Click Create and save the downloaded file to your PC (e.g., in your C:\\Code folder). Keep this safe!* |
| Network settings | Check **Allow SSH traffic from** -> **Anywhere**. |
| Configure storage | You can increase this up to **30 GB** for free. |

5. Click **Launch instance** at the bottom right.
6. Click on the Instance ID to view it, and copy your **Public IPv4 address**.

---

## Step 3: SSH Into Your VM

Because AWS uses `.pem` key files for security, you'll need the key you downloaded in Step 2.

Open PowerShell on your Windows PC and run:
```powershell
# Navigate to where your key is saved
cd C:\Code

# Connect to the AWS VM (replace with your IP)
ssh -i "aws-key.pem" ubuntu@YOUR_PUBLIC_IPV4_ADDRESS
```

*Note: Type `yes` when asked if you are sure you want to continue connecting.*

---

## Step 4: Upload Your Code

Once connected to your AWS VM, clone your code repository.

**Using Git (recommended)**
Make sure your code is in a private GitHub repository first.
```bash
# Update packages and install git
sudo apt-get update && sudo apt-get install -y git

# Clone your repository
git clone https://github.com/YOUR_USER/liquidation-tool.git
cd liquidation-tool
```

---

## Step 5: Run the Setup Script

```bash
chmod +x setup.sh
./setup.sh
```

This will:
1. Install Node.js 20
2. Install PM2 (process manager)
3. Install npm dependencies
4. Prompt you to edit `.env` with your keys
5. Start the bot with auto-restart

When it asks you to edit `.env`:
```bash
nano .env
```
Fill in your configuration:
```ini
PRIVATE_KEY=0x_your_hot_wallet_private_key
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
LIQUIDATOR_CONTRACT_ADDRESS=0x_your_deployed_contract
```
Save by pressing `Ctrl+X` → type `Y` to confirm → press `Enter`.

---

## Step 6: Verify It's Running

```bash
# Check status
pm2 status

# Should show:
# ┌──────────┬────┬──────┬───────┬────────┐
# │ Name     │ id │ mode │ status│ cpu    │
# ├──────────┼────┼──────┼───────┼────────┤
# │ liquidator│ 0 │ fork │ online│ 0.1%  │
# └──────────┴────┴──────┴───────┴────────┘

# View live logs
pm2 logs liquidator
```

---

## Step 7: Close Your Terminal and Walk Away

The bot now runs 24/7 on your AWS EC2 instance:

- ✅ **Auto-restarts** if it crashes (PM2)
- ✅ **Survives reboots** (`pm2 startup` configured)
- ✅ **Costs $0/month** for your first 12 months (750 hours/month included)
- ✅ **Independent** — you can turn off your local PC safely.

---

## Updating the Bot in the Future

When you make changes to your code locally and push to GitHub, SSH back into AWS and run:
```bash
cd ~/liquidation-tool
git pull
npm install
pm2 restart liquidator
```
