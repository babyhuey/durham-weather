# Android build + emulator toolchain. Nothing Android is installed on the host.
FROM eclipse-temurin:17-jdk-jammy

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/gradle
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

# Shared libraries the headless emulator needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      unzip curl libpulse0 libgl1 libnss3 libxcomposite1 libxcursor1 libxdamage1 \
      libxi6 libxtst6 libxrandr2 libasound2 libxkbfile1 libdbus-1-3 libx11-xcb1 libxcb-cursor0 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p $ANDROID_HOME/cmdline-tools \
    && curl -sSfLo /tmp/clt.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
    && unzip -q /tmp/clt.zip -d $ANDROID_HOME/cmdline-tools \
    && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm /tmp/clt.zip

RUN yes | sdkmanager --licenses >/dev/null \
    && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" \
       "emulator" "system-images;android-35;google_apis;x86_64" >/dev/null

RUN echo no | avdmanager create avd -n test -k "system-images;android-35;google_apis;x86_64" -d pixel_7 \
    && printf 'hw.keyboard=yes\nhw.ramSize=3072\n' >> /root/.android/avd/test.avd/config.ini

WORKDIR /src
