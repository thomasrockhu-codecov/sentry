import {browserHistory} from 'react-router';
import type {Location} from 'history';

import {reactHooks} from 'sentry-test/reactTestingLibrary';

import hydrateErrors from 'sentry/utils/replays/hydrateErrors';
import {useLocation} from 'sentry/utils/useLocation';
import useErrorFilters, {
  ErrorSelectOption,
  FilterFields,
} from 'sentry/views/replays/detail/errorList/useErrorFilters';

jest.mock('react-router');
jest.mock('sentry/utils/useLocation');

const mockUseLocation = useLocation as jest.MockedFunction<typeof useLocation>;
const mockBrowserHistoryPush = browserHistory.push as jest.MockedFunction<
  typeof browserHistory.push
>;

const [ERROR_1_JS_RANGEERROR, ERROR_2_NEXTJS_TYPEERROR, ERROR_3_JS_UNDEFINED] =
  hydrateErrors(
    TestStubs.ReplayRecord({started_at: new Date('2023-06-09T12:00:00+00:00')}),
    [
      TestStubs.Replay.RawReplayError({
        'error.type': ['RangeError'],
        timestamp: new Date('2023-06-09T12:00:00+00:00'),
        id: '415ecb5c85ac43b19f1886bb41ddab96',
        'issue.id': 11,
        issue: 'JAVASCRIPT-RANGE',
        title: 'Invalid time value',
        'project.name': 'javascript',
      }),
      TestStubs.Replay.RawReplayError({
        'error.type': ['TypeError'],
        timestamp: new Date('2023-06-09T12:10:00+00:00'),
        id: 'ac43b19f1886bb41ddab96415ecb5c85',
        'issue.id': 22,
        issue: 'NEXTJS-TYPE',
        title: `undefined is not an object (evaluating 'e.apply').`,
        'project.name': 'next-js',
      }),
      TestStubs.Replay.RawReplayError({
        'error.type': ['TypeError'],
        timestamp: new Date('2023-06-09T12:20:00+00:00'),
        id: '9f1886bb41ddab96415ecb5c85ac43b1',
        'issue.id': 22,
        issue: 'JAVASCRIPT-UNDEF',
        title: `Maximum update depth exceeded`,
        'project.name': 'javascript',
      }),
    ]
  );

describe('useErrorFilters', () => {
  beforeEach(() => {
    mockBrowserHistoryPush.mockReset();
  });

  it('should update the url when setters are called', () => {
    const errorFrames = [
      ERROR_1_JS_RANGEERROR,
      ERROR_2_NEXTJS_TYPEERROR,
      ERROR_3_JS_UNDEFINED,
    ];

    const PROJECT_OPTION = {
      value: 'resource.fetch',
      label: 'resource.fetch',
      qs: 'f_e_project',
    } as ErrorSelectOption;
    const SEARCH_FILTER = 'BadRequestError';

    mockUseLocation
      .mockReturnValueOnce({
        pathname: '/',
        query: {},
      } as Location<FilterFields>)
      .mockReturnValueOnce({
        pathname: '/',
        query: {f_e_project: [PROJECT_OPTION.value]},
      } as Location<FilterFields>);

    const {result, rerender} = reactHooks.renderHook(useErrorFilters, {
      initialProps: {errorFrames},
    });

    result.current.setFilters([PROJECT_OPTION]);
    expect(browserHistory.push).toHaveBeenLastCalledWith({
      pathname: '/',
      query: {
        f_e_project: [PROJECT_OPTION.value],
      },
    });

    rerender();

    result.current.setSearchTerm(SEARCH_FILTER);
    expect(browserHistory.push).toHaveBeenLastCalledWith({
      pathname: '/',
      query: {
        f_e_project: [PROJECT_OPTION.value],
        f_e_search: SEARCH_FILTER,
      },
    });
  });

  it('should not filter anything when no values are set', () => {
    const errorFrames = [
      ERROR_1_JS_RANGEERROR,
      ERROR_2_NEXTJS_TYPEERROR,
      ERROR_3_JS_UNDEFINED,
    ];

    mockUseLocation.mockReturnValue({
      pathname: '/',
      query: {},
    } as Location<FilterFields>);

    const {result} = reactHooks.renderHook(useErrorFilters, {
      initialProps: {errorFrames},
    });
    expect(result.current.items).toHaveLength(3);
  });

  it('should filter by project', () => {
    const errorFrames = [
      ERROR_1_JS_RANGEERROR,
      ERROR_2_NEXTJS_TYPEERROR,
      ERROR_3_JS_UNDEFINED,
    ];

    mockUseLocation.mockReturnValue({
      pathname: '/',
      query: {
        f_e_project: ['javascript'],
      },
    } as Location<FilterFields>);

    const {result} = reactHooks.renderHook(useErrorFilters, {
      initialProps: {errorFrames},
    });
    expect(result.current.items).toStrictEqual([
      ERROR_1_JS_RANGEERROR,
      ERROR_3_JS_UNDEFINED,
    ]);
  });

  it('should filter by searchTerm', () => {
    const errorFrames = [
      ERROR_1_JS_RANGEERROR,
      ERROR_2_NEXTJS_TYPEERROR,
      ERROR_3_JS_UNDEFINED,
    ];

    mockUseLocation.mockReturnValue({
      pathname: '/',
      query: {
        f_e_search: 'Maximum update depth',
      },
    } as Location<FilterFields>);

    const {result} = reactHooks.renderHook(useErrorFilters, {
      initialProps: {errorFrames},
    });
    expect(result.current.items).toHaveLength(1);
  });

  describe('getProjectOptions', () => {
    it('should default to having nothing in the list of method types', () => {
      const errorFrames = [];

      const {result} = reactHooks.renderHook(useErrorFilters, {
        initialProps: {errorFrames},
      });

      expect(result.current.getProjectOptions()).toStrictEqual([]);
    });

    it('should return a sorted list of project slugs', () => {
      const errorFrames = [ERROR_2_NEXTJS_TYPEERROR, ERROR_3_JS_UNDEFINED];

      const {result} = reactHooks.renderHook(useErrorFilters, {
        initialProps: {errorFrames},
      });

      expect(result.current.getProjectOptions()).toStrictEqual([
        {label: 'javascript', value: 'javascript', qs: 'f_e_project'},
        {label: 'next-js', value: 'next-js', qs: 'f_e_project'},
      ]);
    });

    it('should deduplicate BreadcrumbType', () => {
      const errorFrames = [ERROR_1_JS_RANGEERROR, ERROR_3_JS_UNDEFINED];

      const {result} = reactHooks.renderHook(useErrorFilters, {
        initialProps: {errorFrames},
      });

      expect(result.current.getProjectOptions()).toStrictEqual([
        {label: 'javascript', value: 'javascript', qs: 'f_e_project'},
      ]);
    });
  });
});