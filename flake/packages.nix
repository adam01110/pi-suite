_: {
  perSystem = {pkgs, ...}: let
    inherit
      (pkgs)
      # keep-sorted start
      autoPatchelfHook
      buildNpmPackage
      fetchurl
      lib
      stdenv
      # keep-sorted end
      ;

    computerUseTarget =
      if stdenv.hostPlatform.isx86_64
      then {
        arch = "x86_64";
        binaryHash = "sha256-0h55gzb1xrae98hTKIZjmVD+JIVeLbsgXMPzRSiUAg4=";
        cosmicHash = "sha256-wet2Dul9UNwVfWcRlWzYT5dwHJmIVbI8HvG9d2GaFFg=";
        nodeArch = "x64";
      }
      else if stdenv.hostPlatform.isAarch64
      then {
        arch = "aarch64";
        binaryHash = "sha256-UScY62T5HNjvyWEHJ/ZfQOyTIYv+dRprtg/jYmaOIqY=";
        cosmicHash = "sha256-IlALWHrGUKw8yMTd2MdcD9ov0B9Or/0cpIKA3btiCvo=";
        nodeArch = "arm64";
      }
      else throw "pi-suite: unsupported computer-use-linux architecture";

    fetchComputerUse = name: hash:
      fetchurl {
        url = "https://github.com/agent-sh/computer-use-linux/releases/download/v0.5.0/${name}-${computerUseTarget.arch}-unknown-linux-gnu";
        inherit hash;
      };

    computerUseBinary = fetchComputerUse "computer-use-linux" computerUseTarget.binaryHash;
    computerUseCosmic = fetchComputerUse "computer-use-linux-cosmic" computerUseTarget.cosmicHash;

    piSuite = buildNpmPackage {
      pname = "pi-suite";
      version = "0.1.0";

      src = lib.fileset.toSource {
        root = ../.;
        fileset = lib.fileset.unions [
          ../LICENSE
          ../LICENSES
          ../THIRD_PARTY_NOTICES.md
          ../package-lock.json
          ../package.json
          ../skills
          ../src
        ];
      };

      npmDepsHash = "sha256-UcLGyGKlzdllLFXMERcHBcHZ8G1Jvx5SGRQFl9h0asg=";
      npmInstallFlags = [
        "--legacy-peer-deps"
        "--omit=dev"
      ];
      nativeBuildInputs = [autoPatchelfHook];
      buildInputs = with pkgs; [
        # keep-sorted start
        stdenv.cc.cc.lib
        zlib
        # keep-sorted end
      ];
      autoPatchelfIgnoreMissingDeps = ["libc.musl-x86_64.so.1"];
      dontNpmBuild = true;

      COMPUTER_USE_LINUX_SKIP_DOWNLOAD = "1";

      installPhase = ''
        runHook preInstall

        computerUseDir="node_modules/@agent-sh/computer-use-linux/npm/bin"
        install -Dm755 ${computerUseBinary} "$computerUseDir/computer-use-linux-linux-${computerUseTarget.nodeArch}"
        install -Dm755 ${computerUseCosmic} "$computerUseDir/computer-use-linux-cosmic"

        mkdir -p "$out"
        cp -r LICENSE LICENSES THIRD_PARTY_NOTICES.md node_modules package.json skills src "$out/"

        runHook postInstall
      '';
    };
  in {
    packages = {
      default = piSuite;
      pi-suite = piSuite;
    };
  };
}
