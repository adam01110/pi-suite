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
        binaryHash = "sha256-YWC4fWHFbVITc0pljMrgIDiQ392ZaFs7mOdLrU0TtIY=";
        cosmicHash = "sha256-GxNnCH++szJVqXmU8seC33rnLVe+lqCJPPQZHvorz0s=";
        nodeArch = "x64";
      }
      else if stdenv.hostPlatform.isAarch64
      then {
        arch = "aarch64";
        binaryHash = "sha256-RvOgHF68Kd9UT9Q+3qEiCq0qddLb8CxsyqyQQEl27f4=";
        cosmicHash = "sha256-8dSmWBB7/+kFR5sTHa8L5zb/A7sBRf0Fn1WeBe7sobI=";
        nodeArch = "arm64";
      }
      else throw "pi-suite: unsupported computer-use-linux architecture";

    # Release tag and hashes track the @agent-sh/computer-use-linux version in
    # package.json: the Pi extension spawns these binaries from npm/bin.
    fetchComputerUse = name: hash:
      fetchurl {
        url = "https://github.com/agent-sh/computer-use-linux/releases/download/v0.7.0/${name}-${computerUseTarget.arch}-unknown-linux-gnu";
        inherit hash;
      };

    computerUseBinary = fetchComputerUse "computer-use-linux" computerUseTarget.binaryHash;
    computerUseCosmic = fetchComputerUse "computer-use-linux-cosmic" computerUseTarget.cosmicHash;

    # Native prebuilds for platforms and ABIs this host cannot load.
    foreignPrebuildPatterns =
      [
        "*darwin*"
        "*win32*"
        "*windows*"
        "*freebsd*"
      ]
      ++ lib.optional (!stdenv.hostPlatform.isMusl) "*musl*"
      ++ lib.optional stdenv.hostPlatform.isx86_64 "*arm64*"
      ++ lib.optional stdenv.hostPlatform.isAarch64 "*x64*";

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

      npmDepsHash = "sha256-hlwsZ5Urhf1S0xvBRP0tGpSdt/ZX5YNfkO7MGglTJeU=";
      makeCacheWritable = true;
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

        substituteInPlace "node_modules/pi-cache-optimizer/index.ts" --replace-fail '💡' $'\uf0eb' --replace-fail '⚠' $'\uf071' --replace-fail 'ℹ' $'\uf129' --replace-fail '✅' $'\uf00c' --replace-fail '❌' $'\uf00d' --replace-fail '🔀' $'\uf0ec' --replace-fail '📉' $'\uf201' --replace-fail '📊' $'\uf080' --replace-fail '📋' $'\uf0ea' --replace-fail '📝' $'\uf044' --replace-fail "️" ""

        # Pi runs the suite through bun, so the bundled Node CLIs are never
        # executed and their shebangs only matter as store references.
        rm -rf node_modules/.bin

        # Ship only what this platform can execute: drop source maps, type
        # declarations, bundled docs and media, test trees, and prebuilds for
        # other platforms and ABIs.
        find node_modules -type f \
          \( -name '*.map' -o -name '*.d.ts' -o -iname '*.png' -o -iname '*.jpg' \
          -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.ico' \
          -o -iname '*.bmp' -o -iname '*.avif' -o -iname '*.mp4' -o -iname '*.webm' \
          -o -iname '*.mov' \) -delete
        # Skill markdown is Pi package content, so only prose docs go.
        find node_modules -type f -iname '*.md' ! -path '*/skills/*' \
          ! -iname 'LICENSE*' ! -iname 'COPYING*' ! -iname 'NOTICE*' -delete
        find node_modules -type d \
          \( -name test -o -name tests -o -name __tests__ -o -name .github \
          -o -name examples -o -name coverage \) -prune -exec rm -rf {} +
        for pattern in ${lib.escapeShellArgs foreignPrebuildPatterns}; do
          find node_modules -maxdepth 5 -type d -name "$pattern" -prune -exec rm -rf {} +
        done

        # recheck-jar is only the fallback for platforms without a native prebuild.
        if ls -d node_modules/recheck-linux-* > /dev/null 2>&1; then
          rm -rf node_modules/recheck-jar
        fi

        mkdir -p "$out"
        cp -r LICENSE LICENSES THIRD_PARTY_NOTICES.md node_modules package.json skills src "$out/"

        runHook postInstall
      '';

      # Runs after the stdenv fixup phase, which repoints shebangs back at the
      # build nodejs. Rewriting them here keeps nodejs out of the runtime closure.
      postFixup = ''
        grep -rl --binary-files=without-match -E '^#!.*/node$' "$out/node_modules" \
          | xargs -r sed -i '1s|^#!.*|#!/usr/bin/env node|'
      '';
    };
  in {
    packages = {
      default = piSuite;
      pi-suite = piSuite;
    };
  };
}
