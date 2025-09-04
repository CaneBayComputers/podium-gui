class PodiumCli < Formula
  desc "Professional PHP development platform with Docker - One command creates Laravel/WordPress projects"
  homepage "https://github.com/CaneBayComputers/podium-cli"
  url "https://github.com/CaneBayComputers/podium-cli/archive/refs/tags/v1.1.0.tar.gz"
  sha256 "f8721c2a289e1005e30328dc083f9fd22f1dd7c5f9fbfc5ebcbf8d9c559389b9"
  license "MIT"
  version "1.1.0"

  depends_on "docker" => :recommended
  depends_on "git"
  depends_on "curl"
  depends_on "jq"
  depends_on "python@3.12"
  depends_on "mysql-client"
  depends_on "unzip"
  depends_on "p7zip"
  depends_on "trash"
  depends_on "node" => :recommended
  depends_on "npm" => :recommended

  def install
    # Install all source files to the prefix
    prefix.install Dir["*"]
    
    # Create symlink for the main podium command
    bin.install_symlink prefix/"src/podium"
    
    # Make scripts executable
    chmod 0755, prefix/"src/scripts/configure.sh"
    chmod 0755, prefix/"src/podium"
  end

  def post_install
    # Run the configuration script with JSON output (non-interactive)
    system "#{prefix}/src/scripts/configure.sh", "--json-output", "--skip-aws", "--skip-packages"
    
    ohai "Podium CLI installed successfully!"
    puts ""
    puts "🎭 Get started with: podium new"
    puts "📖 Documentation: https://github.com/CaneBayComputers/podium-cli"
    puts ""
  end

  def preuninstall
    # Run podium uninstall to clean up Docker resources before removing CLI
    if File.exist?("#{bin}/podium")
      ohai "Cleaning up Podium Docker resources..."
      
      # Run uninstall with --json-output for clean automated removal
      system "#{bin}/podium", "uninstall", "--json-output", "--delete-images"
      
      puts ""
      puts "✅ Podium Docker cleanup completed"
      puts "🗑️  Removed: containers, images, volumes, networks, hosts entries"
      puts ""
    end
  end

  test do
    # Test that the podium command exists and shows help
    assert_match "Professional PHP Development Platform", shell_output("#{bin}/podium help")
  end

  def caveats
    <<~EOS
      🐳 Docker is required for Podium to work.
      
      If you don't have Docker installed:
        brew install --cask docker
      
      Make sure Docker is running before using Podium.
      
      🚀 Create your first project:
        podium new my-awesome-project
      
      📱 Access projects from any device on your network!
    EOS
  end
end
