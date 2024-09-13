# GitHub Machines


<p>
  <img src="https://img.shields.io/github/contributors/ammar0xff/GitHub_Machines.svg?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/forks/ammar0xff/GitHub_Machines.svg?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/stars/ammar0xff/GitHub_Machines?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/issues/ammar0xff/GitHub_Machines.svg?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/license/ammar0xff/GitHub_Machines?style=for-the-badge&color=red">
</p>

**GitHub_Machiens** is an automation solution that allows users to access Windows, Ubuntu, and macOS machines through
GitHub Actions by forking this repository and configuring access using ngrok.


## Table of Contents

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#features">Features</a>
    <li><a href="#built-With">Built With</a>
    <li><a href="#installation">Installation</a>
    <li><a href="#usage">Usage</a>
      <ul>
        <li><a href="#triggering-the-workflows">Triggering the Workflows</a></li>
        <li><a href="#accessing-machines">Accessing Machines</a>
          <ul>
            <li><a href="#windows">Window</a></li>
            <li><a href="#ubuntu">Ubuntu</a></li>
            <li><a href="#macos">Macos</a></li>
          </ul>
        </li>
      </ul>
    </li>
    <li><a href="#customizing">Customizing</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>



## Features
- **Cross-Platform Support**: Gain access to Windows, Ubuntu, and macOS virtual machines using GitHub Actions.
- **Easy Setup**: Fork the repository and configure access using GitHub Actions workflows.
- **Secure Access**: Use ngrok for secure tunneling into the machines.
- **Customizable Workflows**: Modify GitHub Actions workflows to suit your project requirements.
- **Automated Testing**: Utilize GitHub Actions to test software across multiple platforms.




### Built With

<p>
<img src="https://img.shields.io/badge/github%20actions-%232671E5.svg?style=for-the-badge&logo=githubactions&logoColor=white" />
<img src="https://img.shields.io/badge/GNU%20Bash-4EAA25?style=for-the-badge&logo=GNU%20Bash&logoColor=white" />
<img src="https://img.shields.io/badge/Windows%20Terminal-%234D4D4D.svg?style=for-the-badge&logo=windows-terminal&logoColor=white"/>
</p>



## Installation

To use this project, follow these steps:

1. **Fork the Repository**:
Click the **Fork** button at the top right of this repository.

2. **Set up GitHub Secrets**:
You need to configure the necessary GitHub Secrets to establish a secure connection to the machines using ngrok.

1. Go to your forked repository.
2. Navigate to **Settings > Secrets and variables > Actions**.
3. Add the following secrets:
- `NGROK_TOKEN`: Your ngrok authentication token. [Get ngrok token here](https://ngrok.com).
- `NGROK_DOMAIN`: A custom domain (optional) or ngrok subdomain to use for secure access.

Example:

| Secret Name | Description |
|----------------|-------------------------------------|
| `NGROK_TOKEN`  | Your ngrok authentication token |
| `NGROK_DOMAIN` | Your ngrok subdomain            |

> Note: if your Ngrok account dosen't linked to a payment method, windows WILL NOT work.

## Usage

Once you've forked the repository and set up the GitHub Secrets, you can use the provided workflows to access Windows,
Ubuntu, and macOS machines.

### Triggering the Workflows

1. Go to the **Actions** tab in your forked repository.
2. Select the desired workflow (Windows, Ubuntu, or macOS).
3. Click **Run workflow** to trigger access to the machine.

### Accessing Machines

#### **windows**
- use any RDP client and Navigate to [Ngrok Endpoints](https://dashboard.ngrok.com/cloud-edge/endpoints)
- copy the endpoint of your machine and past it into the rdp client with the user "**runner**" & password
"**P@ssw0rd!**"
- Done.
#### **Ubuntu**
- Navigate to your Ngrok Domain and that's all
#### **Macos**
- SOON..


## Customizing

### Clone the Repository:
If you want to modify the workflows locally, clone the forked repository to your local machine using:

```bash
git clone https://github.com/yourusername/GitHub_Machiens.git
cd GitHub_Machiens
```

<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any
contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also
simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request


### Top contributors:

<a href="https://github.com/ammar0xff/GitHub_Machines/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ammar0xff/GitHub_Machines" alt="contrib.rocks image" />
</a>



<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE.txt` for more information.




<!-- CONTACT -->
## Contact

Ammar Mohamed - ammar0xf@gmail.com

Project Link: [https://github.com/ammar0xff/GitHub_Machines](https://github.com/ammar0xff/GitHub_Machines)




<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Gotty](https://github.com/yudai/gotty)
* [Ngrok](https://ngrok.com/)
