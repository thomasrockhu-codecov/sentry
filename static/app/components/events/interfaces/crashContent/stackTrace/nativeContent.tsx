import {cloneElement, Fragment, useState} from 'react';
import styled from '@emotion/styled';

import Panel from 'sentry/components/panels/panel';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import {Frame, Group, PlatformType} from 'sentry/types';
import {Event} from 'sentry/types/event';
import {StacktraceType} from 'sentry/types/stacktrace';
import {defined} from 'sentry/utils';

import NativeFrame from '../../nativeFrame';
import {getImageRange, parseAddress} from '../../utils';

type Props = {
  data: StacktraceType;
  event: Event;
  platform: PlatformType;
  expandFirstFrame?: boolean;
  groupingCurrentLevel?: Group['metadata']['current_level'];
  hiddenFrameCount?: number;
  includeSystemFrames?: boolean;
  inlined?: boolean;
  isHoverPreviewed?: boolean;
  isShowFramesToggleExpanded?: boolean;
  isSubFrame?: boolean;
  maxDepth?: number;
  meta?: Record<any, any>;
  newestFirst?: boolean;
};

function isRepeatedFrame(frame: Frame, nextFrame?: Frame) {
  if (!nextFrame) {
    return false;
  }
  return (
    frame.lineNo === nextFrame.lineNo &&
    frame.instructionAddr === nextFrame.instructionAddr &&
    frame.package === nextFrame.package &&
    frame.module === nextFrame.module &&
    frame.function === nextFrame.function
  );
}

export function NativeContent({
  data,
  platform,
  event,
  newestFirst,
  isHoverPreviewed,
  inlined,
  groupingCurrentLevel,
  includeSystemFrames = true,
  expandFirstFrame = true,
  maxDepth,
  meta,
}: Props) {
  const [showingAbsoluteAddresses, setShowingAbsoluteAddresses] = useState(false);
  const [showCompleteFunctionName, setShowCompleteFunctionName] = useState(false);
  const [toggleFrameMap, setToggleFrameMap] = useState(setInitialFrameMap());

  const {frames = [], framesOmitted, registers} = data;

  function frameIsVisible(frame: Frame, nextFrame: Frame) {
    return (
      includeSystemFrames ||
      frame.inApp ||
      (nextFrame && nextFrame.inApp) ||
      // the last non-app frame
      (!frame.inApp && !nextFrame) ||
      isFrameUsedForGrouping(frame)
    );
  }

  function setInitialFrameMap(): {[frameIndex: number]: boolean} {
    const indexMap = {};
    (data.frames ?? []).forEach((frame, frameIdx) => {
      const nextFrame = (data.frames ?? [])[frameIdx + 1];
      const repeatedFrame = isRepeatedFrame(frame, nextFrame);
      if (frameIsVisible(frame, nextFrame) && !repeatedFrame && !frame.inApp) {
        indexMap[frameIdx] = false;
      }
    });
    return indexMap;
  }

  function getInitialFrameCounts(): {[frameIndex: number]: number} {
    let count = 0;
    const countMap = {};
    (data.frames ?? []).forEach((frame, frameIdx) => {
      const nextFrame = (data.frames ?? [])[frameIdx + 1];
      const repeatedFrame = isRepeatedFrame(frame, nextFrame);
      if (frameIsVisible(frame, nextFrame) && !repeatedFrame && !frame.inApp) {
        countMap[frameIdx] = count;
        count = 0;
      } else {
        if (!repeatedFrame && !frame.inApp) {
          count += 1;
        }
      }
    });
    return countMap;
  }

  function getRepeatedFrameIndices() {
    const repeats: number[] = [];
    (data.frames ?? []).forEach((frame, frameIdx) => {
      const nextFrame = (data.frames ?? [])[frameIdx + 1];
      const repeatedFrame = isRepeatedFrame(frame, nextFrame);

      if (repeatedFrame) {
        repeats.push(frameIdx);
      }
    });
    return repeats;
  }

  function getHiddenFrameIndices(frameCountMap: {[frameIndex: number]: number}) {
    const repeatedIndeces = getRepeatedFrameIndices();
    let hiddenFrameIndices: number[] = [];
    Object.keys(toggleFrameMap)
      .filter(frameIndex => toggleFrameMap[frameIndex] === true)
      .forEach(indexString => {
        const index = parseInt(indexString, 10);
        const indicesToBeAdded: number[] = [];
        let i = 1;
        let numHidden = frameCountMap[index];
        while (numHidden > 0) {
          if (!repeatedIndeces.includes(index - i)) {
            indicesToBeAdded.push(index - i);
            numHidden -= 1;
          }
          i += 1;
        }
        hiddenFrameIndices = [...hiddenFrameIndices, ...indicesToBeAdded];
      });
    return hiddenFrameIndices;
  }

  function findImageForAddress(
    address: Frame['instructionAddr'],
    addrMode: Frame['addrMode']
  ) {
    const images = event.entries.find(entry => entry.type === 'debugmeta')?.data?.images;

    if (!images || !address) {
      return null;
    }

    const image = images.find((img, idx) => {
      if (!addrMode || addrMode === 'abs') {
        const [startAddress, endAddress] = getImageRange(img);
        return address >= (startAddress as any) && address < (endAddress as any);
      }

      return addrMode === `rel:${idx}`;
    });

    return image;
  }

  function isFrameUsedForGrouping(frame: Frame) {
    const {minGroupingLevel} = frame;

    if (groupingCurrentLevel === undefined || minGroupingLevel === undefined) {
      return false;
    }

    return minGroupingLevel <= groupingCurrentLevel;
  }

  function handleToggleAddresses(mouseEvent: React.MouseEvent<SVGElement>) {
    mouseEvent.stopPropagation(); // to prevent collapsing if collapsible
    setShowingAbsoluteAddresses(!showingAbsoluteAddresses);
  }

  function handleToggleFunctionName(mouseEvent: React.MouseEvent<SVGElement>) {
    mouseEvent.stopPropagation(); // to prevent collapsing if collapsible
    setShowCompleteFunctionName(!showCompleteFunctionName);
  }

  const handleToggleFrames = (
    mouseEvent: React.MouseEvent<HTMLElement>,
    frameIndex: number
  ) => {
    mouseEvent.stopPropagation(); // to prevent toggling frame context

    setToggleFrameMap(prevState => ({
      ...prevState,
      [frameIndex]: !prevState[frameIndex],
    }));
  };

  function getLastFrameIndex() {
    const inAppFrameIndexes = frames
      .map((frame, frameIndex) => {
        if (frame.inApp) {
          return frameIndex;
        }
        return undefined;
      })
      .filter(frame => frame !== undefined);

    return !inAppFrameIndexes.length
      ? frames.length - 1
      : inAppFrameIndexes[inAppFrameIndexes.length - 1];
  }

  function renderOmittedFrames(firstFrameOmitted: any, lastFrameOmitted: any) {
    return t(
      'Frames %d until %d were omitted and not available.',
      firstFrameOmitted,
      lastFrameOmitted
    );
  }

  const firstFrameOmitted = framesOmitted?.[0] ?? null;
  const lastFrameOmitted = framesOmitted?.[1] ?? null;
  const lastFrameIndex = getLastFrameIndex();
  const frameCountMap = getInitialFrameCounts();
  const hiddenFrameIndices: number[] = getHiddenFrameIndices(frameCountMap);

  let nRepeats = 0;

  const maxLengthOfAllRelativeAddresses = frames.reduce(
    (maxLengthUntilThisPoint, frame) => {
      const correspondingImage = findImageForAddress(
        frame.instructionAddr,
        frame.addrMode
      );

      try {
        const relativeAddress = (
          parseAddress(frame.instructionAddr) -
          parseAddress(correspondingImage.image_addr)
        ).toString(16);

        return maxLengthUntilThisPoint > relativeAddress.length
          ? maxLengthUntilThisPoint
          : relativeAddress.length;
      } catch {
        return maxLengthUntilThisPoint;
      }
    },
    0
  );

  let convertedFrames = frames
    .map((frame, frameIndex) => {
      const prevFrame = frames[frameIndex - 1];
      const nextFrame = frames[frameIndex + 1];
      const repeatedFrame = isRepeatedFrame(frame, nextFrame);

      if (repeatedFrame) {
        nRepeats++;
      }

      const isUsedForGrouping = isFrameUsedForGrouping(frame);

      if (
        (frameIsVisible(frame, nextFrame) && !repeatedFrame) ||
        hiddenFrameIndices.includes(frameIndex)
      ) {
        const frameProps = {
          event,
          frame,
          prevFrame,
          nextFrame,
          isExpanded: expandFirstFrame && lastFrameIndex === frameIndex,
          emptySourceNotation: inlined
            ? false
            : lastFrameIndex === frameIndex && frameIndex === 0,
          platform,
          timesRepeated: nRepeats,
          showingAbsoluteAddress: showingAbsoluteAddresses,
          onAddressToggle: handleToggleAddresses,
          onShowFramesToggle: (e: React.MouseEvent<HTMLElement>) => {
            handleToggleFrames(e, frameIndex);
          },
          image: findImageForAddress(frame.instructionAddr, frame.addrMode),
          maxLengthOfRelativeAddress: maxLengthOfAllRelativeAddresses,
          registers: {},
          includeSystemFrames,
          onFunctionNameToggle: handleToggleFunctionName,
          showCompleteFunctionName,
          hiddenFrameCount: frameCountMap[frameIndex],
          isHoverPreviewed,
          isShowFramesToggleExpanded: toggleFrameMap[frameIndex],
          isSubFrame: hiddenFrameIndices.includes(frameIndex),
          isUsedForGrouping,
          frameMeta: meta?.frames?.[frameIndex],
          registersMeta: meta?.registers,
        };

        nRepeats = 0;

        if (frameIndex === firstFrameOmitted) {
          return (
            <Fragment key={frameIndex}>
              <NativeFrame {...frameProps} />
              {renderOmittedFrames(firstFrameOmitted, lastFrameOmitted)}
            </Fragment>
          );
        }

        return <NativeFrame key={frameIndex} {...frameProps} />;
      }

      if (!repeatedFrame) {
        nRepeats = 0;
      }

      if (frameIndex !== firstFrameOmitted) {
        return null;
      }

      return renderOmittedFrames(firstFrameOmitted, lastFrameOmitted);
    })
    .filter(frame => !!frame) as React.ReactElement[];

  const className = `traceback ${
    includeSystemFrames ? 'full-traceback' : 'in-app-traceback'
  }`;

  if (convertedFrames.length > 0 && registers) {
    const lastFrame = convertedFrames.length - 1;
    convertedFrames[lastFrame] = cloneElement(convertedFrames[lastFrame], {
      registers,
    });
  }

  if (defined(maxDepth)) {
    convertedFrames = convertedFrames.slice(-maxDepth);
  }

  return (
    <Wrapper className={className}>
      <Frames
        isHoverPreviewed={isHoverPreviewed}
        inlined={inlined}
        data-test-id="stack-trace"
      >
        {!newestFirst ? convertedFrames : [...convertedFrames].reverse()}
      </Frames>
    </Wrapper>
  );
}

const Wrapper = styled(Panel)`
  && {
    border-top-left-radius: 0;
    position: relative;
    border: 0;
  }
`;

export const Frames = styled('ul')<{inlined?: boolean; isHoverPreviewed?: boolean}>`
  background: ${p => p.theme.background};
  border-radius: ${p => p.theme.borderRadius};
  border: 1px ${p => 'solid ' + p.theme.border};
  box-shadow: ${p => p.theme.dropShadowMedium};
  margin-bottom: ${space(2)};
  position: relative;
  display: grid;
  overflow: hidden;
  font-size: ${p => p.theme.fontSizeSmall};
  line-height: 16px;
  color: ${p => p.theme.gray500};
  ${p =>
    p.isHoverPreviewed &&
    `
      border: 0;
      border-radius: 0;
      box-shadow: none;
      margin-bottom: 0;
    `}

  ${p =>
    p.inlined &&
    `
      border-radius: 0;
      border-left: 0;
      border-right: 0;
    `}
`;