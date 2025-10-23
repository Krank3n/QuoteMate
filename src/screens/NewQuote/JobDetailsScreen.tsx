/**
 * Job Details Screen
 * First step: Select template and enter job parameters
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Card,
  Chip,
  ActivityIndicator,
  Dialog,
  Portal,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { JOB_TEMPLATES } from '../../data/jobTemplates';
import { createJobFromTemplate } from '../../utils/materialsEstimator';
import { colors } from '../../theme';
import { JobTemplate } from '../../types';
import { analyzeJobDescription, convertLLMMaterialsToMaterials } from '../../services/llmService';
import { generateId } from '../../utils/generateId';
import { bunningsApi } from '../../services/bunningsApi';
import { WebContainer } from '../../components/WebContainer';

export function JobDetailsScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, updateQuote } = useStore();

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [jobAddress, setJobAddress] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<JobTemplate | null>(null);
  const [customParams, setCustomParams] = useState<Record<string, number>>({});
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisErrorDialogVisible, setAnalysisErrorDialogVisible] = useState(false);
  const [analysisErrorMessage, setAnalysisErrorMessage] = useState('');

  // Check if editing an existing quote
  const isEditingExisting = !!(currentQuote && currentQuote.materials.length > 0);

  useEffect(() => {
    if (currentQuote) {
      setCustomerName(currentQuote.customerName);
      setCustomerEmail(currentQuote.customerEmail || '');
      setCustomerPhone(currentQuote.customerPhone || '');
      setJobAddress(currentQuote.jobAddress || '');
      setJobName(currentQuote.job.name);
      setJobDescription(currentQuote.job.description || '');

      // Load template if exists
      const template = JOB_TEMPLATES.find((t) => t.id === currentQuote.job.template);
      if (template) {
        setSelectedTemplate(template);
        setCustomParams(currentQuote.job.customParams || {});
      }
    }

    // Set default template to 'custom' if no template is selected
    if (!selectedTemplate) {
      const customTemplate = JOB_TEMPLATES.find((t) => t.id === 'custom');
      if (customTemplate) {
        setSelectedTemplate(customTemplate);
      }
    }
  }, [currentQuote]);

  const handleTemplateSelect = (template: JobTemplate) => {
    setSelectedTemplate(template);

    // Initialize default params
    const defaults: Record<string, number> = {};
    template.requiredParams.forEach((param) => {
      defaults[param.key] = param.defaultValue || 0;
    });
    setCustomParams(defaults);
  };

  const handleParamChange = (key: string, value: string) => {
    setCustomParams((prev) => ({
      ...prev,
      [key]: parseFloat(value) || 0,
    }));
  };

  const handleSkipToManualEntry = () => {
    if (!currentQuote) return;

    // Create a job with empty materials list - user will add them manually
    const job = {
      id: generateId(),
      name: jobName || 'Custom Job',
      description: jobDescription,
      template: 'custom' as const,
      estimatedHours: 8, // Default hours
    };

    const updatedQuote = {
      ...currentQuote,
      customerName,
      customerEmail,
      customerPhone,
      jobAddress,
      job,
      materials: [], // Empty - user will add manually
      laborHours: 8,
    };

    updateQuote(updatedQuote);
    navigation.navigate('MaterialsList');
  };

  const handleAnalyzeCustomJob = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('Missing Information', 'Please enter a job description');
      return;
    }

    setIsAnalyzing(true);

    try {
      // Call LLM to analyze job description (with automatic retries built-in)
      const analysis = await analyzeJobDescription(jobDescription);

      if (!currentQuote) return;

      // Convert LLM materials to app materials format
      const baseMaterials = convertLLMMaterialsToMaterials(analysis.materials);

      // Add IDs to materials and ensure all required fields are present
      const materials = baseMaterials.map((m) => ({
        id: generateId(),
        name: m.name || 'Unknown Material',
        quantity: m.quantity || 1,
        unit: m.unit || 'each',
        searchTerm: m.searchTerm,
        price: 0,
        totalPrice: 0,
        manualPriceOverride: false,
      }));

      // Create job object
      const job = {
        id: generateId(),
        name: jobName || analysis.jobSummary || 'Custom Job',
        description: jobDescription,
        template: 'custom' as const,
        estimatedHours: analysis.estimatedHours,
      };

      // Update quote with analyzed data
      const updatedQuote = {
        ...currentQuote,
        customerName,
        customerEmail,
        customerPhone,
        jobAddress,
        job,
        materials,
        laborHours: analysis.estimatedHours,
      };

      updateQuote(updatedQuote);

      // Navigate to materials screen where prices will be fetched
      navigation.navigate('MaterialsList');
    } catch (error: any) {
      console.error('Analysis error:', error);

      // Show user-friendly error with options
      const errorDetail = error.message.includes('API key')
        ? 'API key is not configured.'
        : error.message.includes('429')
        ? 'Rate limit exceeded. Please try again in a moment.'
        : error.message.includes('401') || error.message.includes('403')
        ? 'API authentication failed. Please check your API key.'
        : 'The AI service is temporarily unavailable.';

      setAnalysisErrorMessage(`Unable to generate materials list automatically.\n\n${errorDetail}\n\nWould you like to:`);
      setAnalysisErrorDialogVisible(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNext = () => {
    if (!currentQuote) return;

    if (!customerName.trim()) {
      Alert.alert('Missing Information', 'Please enter customer name');
      return;
    }

    // Template is auto-selected now, but check just in case
    if (!selectedTemplate) {
      const customTemplate = JOB_TEMPLATES.find((t) => t.id === 'custom');
      if (customTemplate) {
        setSelectedTemplate(customTemplate);
      }
      return;
    }

    // Handle custom job differently
    if (selectedTemplate.id === 'custom') {
      // If editing existing quote, just navigate without re-analyzing
      if (isEditingExisting) {
        const updatedQuote = {
          ...currentQuote,
          customerName,
          customerEmail,
          customerPhone,
          jobAddress,
          job: {
            ...currentQuote.job,
            name: jobName || currentQuote.job.name,
            description: jobDescription,
          },
        };
        updateQuote(updatedQuote);
        navigation.navigate('MaterialsList');
        return;
      }
      // Only analyze for new custom jobs
      handleAnalyzeCustomJob();
      return;
    }

    let materials = currentQuote.materials;
    let estimatedHours = currentQuote.laborHours;
    let job = currentQuote.job;

    // Only regenerate materials if this is a new quote without materials
    if (!isEditingExisting) {
      const templateData = createJobFromTemplate(
        selectedTemplate,
        customParams,
        jobName || selectedTemplate.name
      );
      materials = templateData.materials;
      estimatedHours = templateData.estimatedHours;
      job = templateData.job;
    } else {
      // Update job details but keep existing materials
      job = {
        ...currentQuote.job,
        name: jobName || currentQuote.job.name,
        description: jobDescription,
        customParams,
      };
    }

    // Update quote with customer details (preserve materials)
    const updatedQuote = {
      ...currentQuote,
      customerName,
      customerEmail,
      customerPhone,
      jobAddress,
      job,
      materials,
      laborHours: estimatedHours,
    };

    updateQuote(updatedQuote);
    navigation.navigate('MaterialsList');
  };

  const scrollContent = (
    <ScrollView
      style={[
        styles.container,
        Platform.OS === 'web' && { height: '100%', overflow: 'scroll', display: 'block' as any }
      ]}
      contentContainerStyle={[
        styles.scrollContent,
        Platform.OS === 'web' && { flexGrow: 0, display: 'block' as any }
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <WebContainer>
      <Surface style={[styles.paramsSection, styles.firstSection]}>
        <View style={styles.sectionTitleContainer}>
          <MaterialCommunityIcons name="account" size={24} color={colors.primary} style={styles.sectionIcon} />
          <Title style={styles.sectionTitle}>Customer Details</Title>
        </View>

        <TextInput
          label="Customer Name *"
          value={customerName}
          onChangeText={setCustomerName}
          mode="outlined"
          style={styles.input}
        />

        <TextInput
          label="Email"
          value={customerEmail}
          onChangeText={setCustomerEmail}
          mode="outlined"
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          label="Phone"
          value={customerPhone}
          onChangeText={setCustomerPhone}
          mode="outlined"
          style={styles.input}
          keyboardType="phone-pad"
        />

        <TextInput
          label="Job Address"
          value={jobAddress}
          onChangeText={setJobAddress}
          mode="outlined"
          style={styles.input}
          multiline
          numberOfLines={2}
        />
      </Surface>

      {/* Template Selection - Commented out for now
      <View style={styles.section}>
        <Title style={styles.sectionTitle}>Select Job Template</Title>
        {isEditingExisting && (
          <Text style={styles.helperText}>
            Template is locked when editing an existing quote.
          </Text>
        )}

        <View style={styles.templatesGrid}>
          {JOB_TEMPLATES.map((template) => (
            <TouchableOpacity
              key={template.id}
              onPress={() => handleTemplateSelect(template)}
              style={styles.templateCardWrapper}
              disabled={isEditingExisting}
            >
              <Card
                style={[
                  styles.templateCard,
                  selectedTemplate?.id === template.id && styles.selectedCard,
                  isEditingExisting && styles.disabledCard,
                ]}
              >
                <Card.Content>
                  <MaterialCommunityIcons
                    name={getTemplateIcon(template.id)}
                    size={32}
                    color={
                      selectedTemplate?.id === template.id
                        ? colors.primary
                        : colors.onSurface
                    }
                  />
                  <Text style={styles.templateName}>{template.name}</Text>
                  <Text style={styles.templateDesc}>{template.description}</Text>
                </Card.Content>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      */}

      {/* Job Description */}
      <Surface style={styles.paramsSection}>
        <View style={styles.sectionTitleContainer}>
          <MaterialCommunityIcons name="hammer-wrench" size={24} color={colors.primary} style={styles.sectionIcon} />
          <Title style={styles.sectionTitle}>Job Description</Title>
        </View>
        <Text style={styles.helperText}>
          Describe the job in detail. AI will analyze it and suggest materials, or skip to enter materials manually.
        </Text>

        <TextInput
          label="Job Name (Optional)"
          value={jobName}
          onChangeText={setJobName}
          mode="outlined"
          style={styles.input}
          placeholder="e.g., Backyard Deck Renovation"
          multiline
          numberOfLines={3}
        />

        <TextInput
          label="Job Description *"
          value={jobDescription}
          onChangeText={setJobDescription}
          mode="outlined"
          style={styles.input}
          multiline
          numberOfLines={6}
          placeholder="e.g., Build a 5x4 meter outdoor deck with 10 steps leading down to the garden. Need to replace old timber and add handrails."
        />

        {!isEditingExisting && (
          <Button
            mode="text"
            onPress={handleSkipToManualEntry}
            style={styles.skipButton}
            icon="pencil"
            disabled={!customerName.trim()}
          >
            Skip AI & Enter Materials Manually
          </Button>
        )}
      </Surface>

      {/* Standard Template Parameters */}
      {selectedTemplate && selectedTemplate.id !== 'custom' && selectedTemplate.requiredParams.length > 0 && (
        <Surface style={styles.paramsSection}>
          <Title style={styles.sectionTitle}>Job Parameters</Title>
          {isEditingExisting && (
            <Text style={styles.helperText}>
              Parameters are locked when editing. To change them, create a new quote.
            </Text>
          )}

          <TextInput
            label="Job Name (Optional)"
            value={jobName}
            onChangeText={setJobName}
            mode="outlined"
            style={styles.input}
            placeholder={selectedTemplate.name}
            multiline
            numberOfLines={2}
          />

          {selectedTemplate.requiredParams.map((param) => (
            <TextInput
              key={param.key}
              label={`${param.label} ${param.unit ? `(${param.unit})` : ''}`}
              value={customParams[param.key]?.toString() || ''}
              onChangeText={(value) => handleParamChange(param.key, value)}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              disabled={isEditingExisting}
            />
          ))}
        </Surface>
      )}

        <Button
          mode="contained"
          onPress={handleNext}
          style={styles.nextButton}
          disabled={
            !customerName.trim() ||
            isAnalyzing ||
            (!jobDescription.trim() && !isEditingExisting)
          }
          loading={isAnalyzing}
        >
          {isAnalyzing ? 'Analyzing...' : (!isEditingExisting ? 'Analyze & Continue' : 'Next: Materials')}
        </Button>
      </WebContainer>
    </ScrollView>
  );

  return (
    <>
      <Portal>
        <Dialog visible={analysisErrorDialogVisible} onDismiss={() => setAnalysisErrorDialogVisible(false)}>
          <Dialog.Title>AI Analysis Failed</Dialog.Title>
          <Dialog.Content>
            <Text>{analysisErrorMessage}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAnalysisErrorDialogVisible(false)}>Cancel</Button>
            <Button onPress={() => { setAnalysisErrorDialogVisible(false); handleSkipToManualEntry(); }}>Enter Manually</Button>
            <Button onPress={() => { setAnalysisErrorDialogVisible(false); handleAnalyzeCustomJob(); }}>Try Again</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <KeyboardAvoidingView
        style={Platform.OS === 'web'
          ? { height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } as any
          : { flex: 1 }
        }
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {scrollContent}
      </KeyboardAvoidingView>
    </>
  );
}

function getTemplateIcon(templateId: string): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (templateId) {
    case 'outdoor-stairs':
      return 'stairs';
    case 'timber-deck':
      return 'home-floor-2';
    case 'timber-fence':
      return 'fence';
    case 'pergola':
      return 'home-roof';
    default:
      return 'hammer-wrench';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 220,
    flexGrow: 1,
  },
  section: {
    padding: 20,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 0,
  },
  input: {
    marginBottom: 20,
  },
  templatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  templateCardWrapper: {
    width: '50%',
    padding: 6,
  },
  templateCard: {
    minHeight: 140,
    backgroundColor: colors.surface,
  },
  selectedCard: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  disabledCard: {
    opacity: 0.5,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  templateDesc: {
    fontSize: 11,
    color: colors.onSurface,
  },
  paramsSection: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  firstSection: {
    marginTop: 20,
  },
  nextButton: {
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 80,
    paddingVertical: 8,
  },
  skipButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  helperText: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 12,
  },
  analyzingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  analyzingText: {
    marginLeft: 12,
    fontSize: 14,
    color: colors.primary,
  },
  debugInfo: {
    padding: 10,
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: colors.surfaceGray3,
  },
});
