import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MoreScreen from '../screens/MoreScreen';
import GoalsScreen from '../screens/GoalsScreen';
import CreateGoalScreen from '../screens/CreateGoalScreen';
import TeamScreen from '../screens/TeamScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SprintsScreen from '../screens/SprintsScreen';
import CreateSprintScreen from '../screens/CreateSprintScreen';
import SprintDetailScreen from '../screens/SprintDetailScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import MeetingsScreen from '../screens/MeetingsScreen';
import MeetingDetailScreen from '../screens/MeetingDetailScreen';
import CreateMeetingScreen from '../screens/CreateMeetingScreen';
import DocsScreen from '../screens/DocsScreen';
import DocDetailScreen from '../screens/DocDetailScreen';
import DecisionsScreen from '../screens/DecisionsScreen';
import CreateDecisionScreen from '../screens/CreateDecisionScreen';
import ChangeRequestsScreen from '../screens/ChangeRequestsScreen';
import CreateChangeRequestScreen from '../screens/CreateChangeRequestScreen';
import KpisScreen from '../screens/KpisScreen';
import SearchScreen from '../screens/SearchScreen';
import ChannelsScreen from '../screens/ChannelsScreen';
import ChannelDetailScreen from '../screens/ChannelDetailScreen';
import CreateChannelScreen from '../screens/CreateChannelScreen';
import AutomationsScreen from '../screens/AutomationsScreen';
import RaidScreen from '../screens/RaidScreen';
import CreateRaidEntryScreen from '../screens/CreateRaidEntryScreen';
import SopsScreen from '../screens/SopsScreen';
import SopDetailScreen from '../screens/SopDetailScreen';
import PortfolioScreen from '../screens/PortfolioScreen';
import BillingScreen from '../screens/BillingScreen';
import ExecutiveScreen from '../screens/ExecutiveScreen';
import CategoriesScreen from '../screens/CategoriesScreen';
import CreateCategoryScreen from '../screens/CreateCategoryScreen';
import CustomFieldsScreen from '../screens/CustomFieldsScreen';
import AdminUsageScreen from '../screens/AdminUsageScreen';
import { colors } from '../theme/theme';

const Stack = createNativeStackNavigator();

export default function MoreStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: '700', color: colors.gray900 },
        headerTintColor: colors.brand600,
      }}
    >
      <Stack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'More' }} />
      <Stack.Screen name="Goals" component={GoalsScreen} options={{ title: 'Goals' }} />
      <Stack.Screen
        name="CreateGoal"
        component={CreateGoalScreen}
        options={{ title: 'New Goal', presentation: 'modal' }}
      />
      <Stack.Screen name="Team" component={TeamScreen} options={{ title: 'Team' }} />
      <Stack.Screen name="Sprints" component={SprintsScreen} options={{ title: 'Sprints' }} />
      <Stack.Screen
        name="CreateSprint"
        component={CreateSprintScreen}
        options={{ title: 'New Sprint', presentation: 'modal' }}
      />
      <Stack.Screen name="SprintDetail" component={SprintDetailScreen} options={{ title: 'Sprint' }} />
      <Stack.Screen name="Meetings" component={MeetingsScreen} options={{ title: 'Meetings' }} />
      <Stack.Screen name="MeetingDetail" component={MeetingDetailScreen} options={{ title: 'Meeting' }} />
      <Stack.Screen
        name="CreateMeeting"
        component={CreateMeetingScreen}
        options={{ title: 'New Meeting', presentation: 'modal' }}
      />
      <Stack.Screen name="Docs" component={DocsScreen} options={{ title: 'Docs' }} />
      <Stack.Screen name="DocDetail" component={DocDetailScreen} options={{ title: 'Doc' }} />
      <Stack.Screen name="Decisions" component={DecisionsScreen} options={{ title: 'Decisions' }} />
      <Stack.Screen
        name="CreateDecision"
        component={CreateDecisionScreen}
        options={{ title: 'Log Decision', presentation: 'modal' }}
      />
      <Stack.Screen name="ChangeRequests" component={ChangeRequestsScreen} options={{ title: 'Change Requests' }} />
      <Stack.Screen
        name="CreateChangeRequest"
        component={CreateChangeRequestScreen}
        options={{ title: 'New Change Request', presentation: 'modal' }}
      />
      <Stack.Screen name="Kpis" component={KpisScreen} options={{ title: 'KPIs' }} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
      <Stack.Screen name="Channels" component={ChannelsScreen} options={{ title: 'Channels' }} />
      <Stack.Screen
        name="ChannelDetail"
        component={ChannelDetailScreen}
        options={({ route }) => ({ title: route.params?.channelName || 'Channel' })}
      />
      <Stack.Screen
        name="CreateChannel"
        component={CreateChannelScreen}
        options={{ title: 'New Channel', presentation: 'modal' }}
      />
      <Stack.Screen name="Automations" component={AutomationsScreen} options={{ title: 'Automations' }} />
      <Stack.Screen name="Raid" component={RaidScreen} options={{ title: 'RAID Log' }} />
      <Stack.Screen
        name="CreateRaidEntry"
        component={CreateRaidEntryScreen}
        options={{ title: 'New RAID Entry', presentation: 'modal' }}
      />
      <Stack.Screen name="Sops" component={SopsScreen} options={{ title: 'SOPs' }} />
      <Stack.Screen name="SopDetail" component={SopDetailScreen} options={{ title: 'SOP' }} />
      <Stack.Screen name="Portfolio" component={PortfolioScreen} options={{ title: 'Portfolio' }} />
      <Stack.Screen name="Billing" component={BillingScreen} options={{ title: 'Billing' }} />
      <Stack.Screen name="Executive" component={ExecutiveScreen} options={{ title: 'Executive Overview' }} />
      <Stack.Screen name="Categories" component={CategoriesScreen} options={{ title: 'Categories' }} />
      <Stack.Screen
        name="CreateCategory"
        component={CreateCategoryScreen}
        options={{ title: 'New Category', presentation: 'modal' }}
      />
      <Stack.Screen name="CustomFields" component={CustomFieldsScreen} options={{ title: 'Custom Fields' }} />
      <Stack.Screen name="AdminUsage" component={AdminUsageScreen} options={{ title: 'Usage' }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Stack.Navigator>
  );
}
